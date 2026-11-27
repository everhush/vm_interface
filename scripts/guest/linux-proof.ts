/** Actual native Linux application; no host command or simulated input. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {openSync,closeSync,readSync,writeSync,fsyncSync,constants,readFileSync,writeFileSync,renameSync,readdirSync,statSync,existsSync,unlinkSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {machine} from "node:os";
import {storedZip} from "../zip-writer.ts";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
function publish(name:string,data:Buffer){
 writeFileSync("."+name+".tmp",data);writeFileSync("."+name+".sha256.tmp",sha(data)+"\n");
 renameSync("."+name+".tmp","out-"+name);renameSync("."+name+".sha256.tmp","out-"+name+".sha256");
}
async function device(name:string){
 const p="/dev/disk/by-id/virtio-d-"+name;
 for(let i=0;i<60&&!existsSync(p);i++)await delay(500);
 assert(statSync(p).isBlockDevice(),"Expected actual guest block device");return p;
}
function readBlock(p:string){
 const fd=openSync(p,"r");try{const b=Buffer.alloc(4096);let n=0;while(n<b.length){const m=readSync(fd,b,n,b.length-n,n);assert(m>0);n+=m;}return b;}finally{closeSync(fd);}
}
function writeBlock(p:string,b:Buffer){
 const fd=openSync(p,"r+");try{let n=0;while(n<b.length){const m=writeSync(fd,b,n,b.length-n,n);assert(m>0);n+=m;}fsyncSync(fd);}finally{closeSync(fd);}assert(readBlock(p).equals(b));
}
async function pointer(challenge:Buffer){
 const names=readdirSync("/sys/class/input").filter(n=>/^event\d+$/.test(n)).map(n=>({node:n,name:readFileSync("/sys/class/input/"+n+"/device/name","utf8").trim()})).filter(v=>/tablet/i.test(v.name));
 assert.equal(names.length,1,"Expected exactly one native tablet");
 const fd=openSync("/dev/input/"+names[0].node,constants.O_RDONLY|constants.O_NONBLOCK);
 let x:number|undefined,y:number|undefined,pressed=false,released=false;
 const buf=Buffer.alloc(24*64),end=Date.now()+45000;
 console.log("pointerready");
 try{while(Date.now()<end){
  let n=0;try{n=readSync(fd,buf,0,buf.length,null);}catch(e){if((e as NodeJS.ErrnoException).code!=="EAGAIN")throw e;}
  assert.equal(n%24,0,"Partial native input_event");
  for(let i=0;i<n;i+=24){const type=buf.readUInt16LE(i+16),code=buf.readUInt16LE(i+18),value=buf.readInt32LE(i+20);
   if(type===3&&code===0)x=value;if(type===3&&code===1)y=value;
   if(type===1&&code===272&&value===1)pressed=true;if(type===1&&code===272&&value===0&&pressed)released=true;
  }
  if(x!==undefined&&y!==undefined&&pressed&&released)break;await delay(25);
 }}finally{closeSync(fd);}
 assert(x!==undefined&&y!==undefined&&x>=0&&x<=65535&&y>=0&&y<=65535&&pressed&&released,"Actual absolute pointer and click were not observed");
 publish("pointer-receipt.json",Buffer.from(JSON.stringify({device:names[0].name,absoluteX:x,absoluteY:y,leftPress:pressed,leftRelease:released,challengeSha256:sha(challenge)})));
 console.log("pointerdone");
}
async function main(){
 assert(process.platform==="linux"&&process.arch==="x64"&&machine()==="x86_64"&&process.versions.node.startsWith("24."));process.chdir("/mnt/exchange");process.umask(0o002);
 const data=readFileSync("in-challenge.bin");assert.equal(data.length,4096);const original=await device("proof");
 if(process.argv.slice(2).join(" ")==="--verify-clone"){
  const clone=await device("proofcopy");assert.notEqual(statSync(original).rdev,statSync(clone).rdev);assert(readBlock(original).equals(data)&&readBlock(clone).equals(data));
  const alternate=Buffer.from(data.map(x=>x^255));writeBlock(clone,alternate);assert(readBlock(original).equals(data));publish("disk-original-after.bin",readBlock(original));publish("disk-clone-after.bin",readBlock(clone));execFileSync("sync");console.log("proofpersisted");return;
 }
 assert.equal(process.argv.length,2);await pointer(data);writeBlock(original,data);publish("disk-original.bin",readBlock(original));
 const archive=storedZip([["challenge.bin",data]]);writeFileSync(".archive.zip",archive);execFileSync("unzip",["-tq",".archive.zip"]);assert.equal(execFileSync("unzip",["-Z1",".archive.zip"],{encoding:"utf8"}).trim(),"challenge.bin");assert(execFileSync("unzip",["-p",".archive.zip","challenge.bin"]).equals(data));publish("archive.zip",archive);unlinkSync(".archive.zip");
 publish("guest-platform.json",Buffer.from(JSON.stringify({machine:machine(),release:readFileSync("/etc/os-release","utf8")})));
 const rpm=execFileSync("rpm",["-qa","--qf","%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{LICENSE}\\n"],{encoding:"utf8",maxBuffer:8*1024*1024}).trimEnd().split("\n").sort().join("\n")+"\n";assert(rpm.length>0&&Buffer.byteLength(rpm)<=8*1024*1024);publish("guest-rpm.tsv",Buffer.from(rpm));
 publish("guest-runtime.json",Buffer.from(JSON.stringify({node:process.version,architecture:process.arch,executableSha256:sha(readFileSync(process.execPath)),challengeSha256:sha(data)})));
 publish("result.bin",Buffer.from("guest-result:"+sha(data)+"\n"));execFileSync("sync");console.log("proofcomplete");console.log("guest-result:"+sha(data));
}
await main();
