/** Bounded ZIP central-directory reader. Supports ZIP64 sizes/offsets, never extracts paths automatically. */
import assert from "node:assert/strict";
import {openSync,closeSync,readSync,fstatSync,createReadStream,createWriteStream} from "node:fs";
import {Transform,Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createInflateRaw,crc32} from "node:zlib";
const decoder=new TextDecoder("utf-8",{fatal:true});
const safe=(v:bigint)=>{assert(v<=BigInt(Number.MAX_SAFE_INTEGER),"ZIP field exceeds safe integer");return Number(v);};
export type ZipEntry={name:string;size:number;compressed:number;offset:number;flags:number;method:number;crc:number;attributes:number};
export class ZipReader{
 readonly entries:ZipEntry[]=[];
 private fd:number;
 private length:number;
 private central=0;
 constructor(readonly path:string,maxEntries=256){
  this.fd=openSync(path,"r");
  try{
   const st=fstatSync(this.fd);assert(st.isFile()&&st.size>=22,"Invalid ZIP");
   this.length=st.size;
   const tail=this.read(Math.max(0,this.length-65557),Math.min(this.length,65557));
   let end=-1;
   for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
   assert(end>=0,"Missing ZIP end record");
   const e=tail.subarray(end),endOffset=this.length-tail.length+end;
   assert(e.readUInt16LE(4)===0&&e.readUInt16LE(6)===0&&e.readUInt16LE(8)===e.readUInt16LE(10),"Multi-disk ZIP unsupported");
   let count=e.readUInt16LE(10),size=e.readUInt32LE(12),offset=e.readUInt32LE(16),boundary=endOffset;
   if(count===65535||size===0xffffffff||offset===0xffffffff){
    const locator=this.read(endOffset-20,20);assert(locator.readUInt32LE(0)===0x07064b50&&locator.readUInt32LE(4)===0&&locator.readUInt32LE(16)===1,"Invalid ZIP64 locator");
    boundary=safe(locator.readBigUInt64LE(8));const z=this.read(boundary,56);
    assert(z.readUInt32LE(0)===0x06064b50&&z.readBigUInt64LE(4)>=44n&&z.readUInt32LE(16)===0&&z.readUInt32LE(20)===0&&z.readBigUInt64LE(24)===z.readBigUInt64LE(32),"Invalid ZIP64 directory");
    count=safe(z.readBigUInt64LE(32));size=safe(z.readBigUInt64LE(40));offset=safe(z.readBigUInt64LE(48));
   }
   assert(count<=maxEntries&&size<=16*1024**2&&offset+size<=boundary,"ZIP directory exceeds bounds");
   this.central=offset;const directory=this.read(offset,size);let at=0;
   for(let i=0;i<count;i++){
    assert(at+46<=size&&directory.readUInt32LE(at)===0x02014b50,"Invalid ZIP central entry");
    const nameLen=directory.readUInt16LE(at+28),extraLen=directory.readUInt16LE(at+30),commentLen=directory.readUInt16LE(at+32),next=at+46+nameLen+extraLen+commentLen;
    assert(nameLen>0&&next<=size&&directory.readUInt16LE(at+34)===0,"Invalid ZIP entry bounds");
    const name=decoder.decode(directory.subarray(at+46,at+46+nameLen));
    assert(!name.includes("\0"),"Invalid ZIP filename");
    let compressed=directory.readUInt32LE(at+20),uncompressed=directory.readUInt32LE(at+24),local=directory.readUInt32LE(at+42);
    if([compressed,uncompressed,local].includes(0xffffffff)){
     const extra=directory.subarray(at+46+nameLen,at+46+nameLen+extraLen);let p=0,found=false;
     while(p+4<=extra.length){const id=extra.readUInt16LE(p),len=extra.readUInt16LE(p+2);p+=4;assert(p+len<=extra.length,"Invalid ZIP extra field");if(id===1){let q=p;const field=()=>{assert(q+8<=p+len,"Truncated ZIP64 field");const n=safe(extra.readBigUInt64LE(q));q+=8;return n;};if(uncompressed===0xffffffff)uncompressed=field();if(compressed===0xffffffff)compressed=field();if(local===0xffffffff)local=field();found=true;break;}p+=len;}assert(found,"Missing ZIP64 entry");
    }
    this.entries.push({name,size:uncompressed,compressed,offset:local,flags:directory.readUInt16LE(at+8),method:directory.readUInt16LE(at+10),crc:directory.readUInt32LE(at+16),attributes:directory.readUInt32LE(at+38)});
    at=next;
   }
   assert(at===size,"Unexpected central directory records");
  }catch(e){closeSync(this.fd);throw e;}
 }
 private read(offset:number,size:number){
  assert(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(size)&&size>=0&&offset+size<=this.length,"ZIP read outside file");
  const b=Buffer.alloc(size);let n=0;while(n<size){const r=readSync(this.fd,b,n,size-n,offset+n);assert(r>0,"Truncated ZIP");n+=r;}return b;
 }
 private start(entry:ZipEntry){
  assert(this.entries.includes(entry)&&!(entry.flags&1)&&(entry.method===0||entry.method===8),"Unsupported ZIP entry");
  const h=this.read(entry.offset,30);assert(h.readUInt32LE(0)===0x04034b50&&h.readUInt16LE(6)===entry.flags&&h.readUInt16LE(8)===entry.method,"Invalid local ZIP entry");
  const len=h.readUInt16LE(26),extra=h.readUInt16LE(28);
  assert(decoder.decode(this.read(entry.offset+30,len))===entry.name,"Local ZIP name mismatch");
  const start=entry.offset+30+len+extra;assert(start+entry.compressed<=this.central,"ZIP data outside archive");
  if(entry.method===0)assert(entry.size===entry.compressed,"Stored ZIP size mismatch");return start;
 }
 async extract(entry:ZipEntry,limit:number,dest:Writable){
  assert(entry.size>=0&&entry.size<=limit&&entry.compressed>0,"ZIP entry exceeds bounds");
  const start=this.start(entry);let count=0,crc=0;
  const check=new Transform({transform(chunk:Buffer,_enc,callback){count+=chunk.length;if(count>entry.size||count>limit){callback(Error("Extracted ZIP entry exceeds bounds"));return;}crc=crc32(chunk,crc);callback(null,chunk);},flush(callback){callback(count===entry.size&&crc===entry.crc?undefined:Error("ZIP entry size or CRC mismatch"));}});
  const source=createReadStream(this.path,{start,end:start+entry.compressed-1});
  if(entry.method===8)await pipeline(source,createInflateRaw(),check,dest);else await pipeline(source,check,dest);
 }
 async buffer(entry:ZipEntry,limit:number){
  const chunks:Buffer[]=[];await this.extract(entry,limit,new Writable({write(chunk:Buffer,_enc,cb){chunks.push(Buffer.from(chunk));cb();}}));return Buffer.concat(chunks);
 }
 async file(entry:ZipEntry,limit:number,path:string){await this.extract(entry,limit,createWriteStream(path,{flags:"wx",mode:0o600}));}
 close(){closeSync(this.fd);}
}
