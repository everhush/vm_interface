import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync,readFileSync,statSync,chmodSync,unlinkSync,symlinkSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {acquire,allowedUrl,checkedStream,publicAddress,resolvePublic} from "../scripts/acquire_image.ts";
const HOST="download.example.com",URL="https://"+HOST+"/image",DATA=Buffer.alloc(4096,113),DIGEST=createHash("sha256").update(DATA).digest("hex");
async function* data(){yield DATA;}
test("URL and public DNS address validation",()=>{
 assert.equal(allowedUrl(URL,new Set([HOST])).hostname,HOST);
 for(const url of ["http://"+HOST,"https://user@"+HOST,"https://"+HOST+":444","https://127.0.0.1/a","https://"+HOST+".evil/a","https://"+HOST+"/#x","https://"+HOST+"/a\\b","https://"+HOST+"/a\nb"])assert.throws(()=>allowedUrl(url,new Set([HOST,"127.0.0.1"])));
 for(const ip of ["127.0.0.1","10.0.0.1","169.254.169.254","100.64.0.1","192.0.2.1","224.0.0.1","::1","::ffff:8.8.8.8","64:ff9b::a00:1","2002:0a00:0001::","fe80::1","::","192.168.1.1"])assert.throws(()=>publicAddress(ip));
 assert.equal(publicAddress("8.8.8.8"),"8.8.8.8");
});
test("mixed DNS answers fail closed",async()=>{await assert.rejects(resolvePublic(HOST,async()=>[{address:"8.8.8.8"},{address:"127.0.0.1"}]));});
test("digest, length and size limits",async()=>{
 assert.equal(await checkedStream(data(),()=>{},DIGEST,4096,4096),4096);
 for(const [sha,bound,size] of [["0".repeat(64),4096,4096],[DIGEST,1024,undefined],[DIGEST,4096,2048]] as const)await assert.rejects(checkedStream(data(),()=>{},sha,bound,size));
});
test("cache revalidates and output inodes are independent",async()=>{
 let calls=0;const root=mkdtempSync(join(tmpdir(),"vm-acquire-")),cache=join(root,"cache");
 const fake:typeof import("../scripts/acquire_image.ts").download=async(_url,_hosts,write,sha,limit,size)=>{calls++;return checkedStream(data(),write,sha,limit,size);};
 const get=(name:string)=>acquire(URL,join(root,name),DIGEST,new Set([HOST]),4096,4096,cache,600,fake);
 try{
  assert.equal((await get("one")).cacheHit,false);writeFileSync(join(root,"one"),"modified");
  assert.equal((await get("two")).cacheHit,true);assert.deepEqual(readFileSync(join(root,"two")),DATA);assert.equal(calls,1);
  const entry=join(cache,DIGEST);assert.notEqual(statSync(join(root,"two")).ino,statSync(entry).ino);
  await assert.rejects(get("two"));chmodSync(entry,0o600);writeFileSync(entry,Buffer.alloc(4096,120));
  await assert.rejects(get("three"));assert(!existsSync(join(root,"three")));unlinkSync(entry);symlinkSync(join(root,"two"),entry);
  await assert.rejects(get("four"));assert(!existsSync(join(root,"four")));
 }finally{rmSync(root,{recursive:true,force:true});}
});
