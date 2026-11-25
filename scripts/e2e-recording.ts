import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const base=process.env.API_URL||"http://127.0.0.1:3000/api/v1";
const a=process.env.TOKEN_A,b=process.env.TOKEN_B;
assert.ok(a&&b);
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(method:string,path:string,token:string,body?:unknown,expected=200,key=randomUUID()){
 const res=await fetch(base+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json","idempotency-key":key},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 assert.equal(res.status,expected,method+" "+path);
 return res.json();
}
const created=await call("POST","/computers",a,{version:1,name:"ci-recording",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke"},202);
const path="/computers/"+created.result.id, collection=path+"/recordings";
try{
 await call("POST",path+"/start",a,{},202);
 let ready=false;
 for(let i=0;i<72;i++){if((await call("GET",path,a)).instance?.status?.phase==="Running"){ready=true;break}await delay(5000)}
 assert.ok(ready,"VM did not start");
 await call("POST",collection,a,{consent:false,maxSeconds:20},422);
 const key=randomUUID(), spec={consent:true,maxSeconds:30};
 const started=await call("POST",collection,a,spec,202,key);
 const id=started.result.id, recording=collection+"/"+id;
 assert.equal((await call("POST",collection,a,spec,202,key)).result.id,id);
 await call("GET",recording,b,undefined,404);
 await call("POST",collection,a,spec,409);
 let active=false;
 for(let i=0;i<40;i++){const state=await call("GET",recording,a);if(state.status==="recording"){active=true;break}assert.notEqual(state.status,"failed",state.error);await delay(500)}
 assert.ok(active,"recording worker did not claim");
 await delay(7000);
 const stopKey=randomUUID();
 await call("POST",recording+"/stop",a,{},202,stopKey);
 await call("POST",recording+"/stop",a,{},202,stopKey);
 let result;
 for(let i=0;i<90;i++){result=await call("GET",recording,a);if(result.status==="completed")break;assert.notEqual(result.status,"failed",result.error);await delay(1000)}
 assert.equal(result?.status,"completed");
 assert.ok(result.durationMs>0&&result.bytes>0&&result.bytes<=64*1024*1024);
 const file=await fetch(base+recording+"/file",{headers:{authorization:"Bearer "+a},signal:AbortSignal.timeout(30000)});
 assert.equal(file.status,200);assert.equal(file.headers.get("content-type"),"video/mp4");
 const data=Buffer.from(await file.arrayBuffer());
 assert.equal(data.length,result.bytes);
 assert.equal(createHash("sha256").update(data).digest("hex"),result.sha256);
 const out="evidence/guest-recording.mp4";writeFileSync(out,data);
 const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",out],{encoding:"utf8",timeout:30000}));
 assert.equal(probe.streams.length,1);assert.equal(probe.streams[0].codec_name,"h264");assert.ok(Number(probe.format.duration)>0);
 execFileSync("ffmpeg",["-v","error","-xerror","-i",out,"-f","null","-"],{timeout:60000});
 const denied=await fetch(base+recording+"/file",{headers:{authorization:"Bearer "+b}});assert.equal(denied.status,404);
 await call("DELETE",recording,a,undefined,202);
 await call("GET",recording,a,undefined,404);
 writeFileSync("evidence/recording-verification.json",JSON.stringify({explicitConsent:true,idempotent:true,crossAccountDenied:true,bytes:data.length,sha256:result.sha256,durationMs:result.durationMs,codec:"h264",fullDecode:true,deleted:true},null,2));
 console.log("Real guest recording retrieved, verified, decoded and deleted");
}finally{await call("DELETE",path,a,undefined,202)}
