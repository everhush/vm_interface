/** Deterministic single-disk ZIP_STORED writer for bounded client fixtures. */
import assert from "node:assert/strict";
import {crc32} from "node:zlib";
export function storedZip(entries:readonly [string,Buffer][]){
 assert(entries.length>0&&entries.length<=256);const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0,centralBytes=0;
 for(const [name,data] of entries){
  const n=Buffer.from(name),crc=crc32(data);assert(n.length>0&&n.length<=4096&&data.length<0xffffffff);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,n,data);centrals.push(central,n);offset+=local.length+n.length+data.length;centralBytes+=central.length+n.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,...centrals,end]);
}
