/** Real guest-visible keyboard authority test. Only disposable test guest,
 * no login/password entry; type visible markers at the guest's login prompt. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {WebSocket,createWebSocketStream} from "ws";
import {connect,type RfbClient} from "rfb2";
import {cirrosNormalize as normalize,cirrosReady} from "./cirros-screen";

const base=process.env.API_URL||"http://127.0.0.1:3000/api/v1";
const gateway=process.env.VNC_URL||"wss://127.0.0.1:3443/api/v1";
const a=process.env.TOKEN_A,b=process.env.TOKEN_B;
assert.ok(a&&b);
const ca=readFileSync(process.env.CONSOLE_CA_PATH||"/tmp/console-tls.crt");
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function readRetry(url:string,init:RequestInit){
 for(let i=0;i<8;i++){
  try{return await fetch(url,{...init,signal:AbortSignal.timeout(30000)})}
  catch(e){if(i===7)throw e;await delay(2000)}
 }
 throw Error("Read transport did not recover");
}
async function call(method:string,path:string,token:string,body?:unknown,expected=200,scheme="Bearer",idempotencyKey=randomUUID()){
 console.log("API",method,path,"expected",expected);
 const request=method==="GET"?readRetry:fetch;
 const r=await request(base+path,{method,headers:{connection:"close",authorization:scheme+" "+token,"content-type":"application/json","idempotency-key":idempotencyKey},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,expected,method+" "+path);
 return r.json();
}
async function screenshot(path:string,filename:string){
 const r=await readRetry(base+path+"/screenshot",{headers:{connection:"close",authorization:"Bearer "+a},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);
 assert.equal(r.headers.get("content-type"),"image/png");
 const data=Buffer.from(await r.arrayBuffer());assert.ok(data.length>100&&data.length<=8*1024*1024);
 writeFileSync(filename,data);
 // OCR is used only to assert the real visible test marker, never to infer
 // guest state from KubeVirt readiness. Retain original PNG for inspection.
 return execFileSync("tesseract",[filename,"stdout","--psm","6","--dpi","180"],{encoding:"utf8",timeout:30000,env:{...process.env,OMP_THREAD_LIMIT:"1",OMP_NUM_THREADS:"1"},stdio:["ignore","pipe","ignore"]}).toLowerCase();
}
async function awaitScreen(path:string,file:string,predicate:(text:string)=>boolean,seconds=90){
 const end=Date.now()+seconds*1000;
 let last="";
 while(Date.now()<end){
  last=await screenshot(path,file);
  if(predicate(last))return last;
  await delay(2000);
 }
 // Retain only expected fixture marker counts and the actual screenshot hash,
 // not raw OCR (the test guest displays public default login instructions).
 const n=normalize(last);
 writeFileSync(file.replace(/\.png$/,"-marker-diagnostic.json"),JSON.stringify({
  screenshotSha256:createHash("sha256").update(readFileSync(file)).digest("hex"),
  markers:Object.fromEntries(["autocitest","humancontrol","batchok","forbiddeninput","observerinput"].map(m=>[m,n.split(m).length-1])),
  loginVisible:n.includes("cirroslogin")
 },null,2));
 throw Error("Expected guest-visible text did not appear; inspect "+file);
}
type Viewer={ws:WebSocket;client:RfbClient};
async function connectViewer(path:string,token:string):Promise<Viewer>{
 const ws=new WebSocket(gateway+path+"/vnc",["binary","vm-ticket."+token],{ca,handshakeTimeout:15000,maxPayload:16*1024*1024,perMessageDeflate:false});
 ws.on("error",()=>{});const stream=createWebSocketStream(ws);stream.on("error",()=>{});
 try{
  const client=await connect({stream,security:[1],initialUpdate:false,timeout:15000});
  client.on("error",()=>{});return {ws,client};
 }catch(e){ws.terminate();throw e}
}
async function typeText(v:Viewer,text:string){
 for(const ch of text){v.client.keyEvent(ch.charCodeAt(0),true);await delay(40);v.client.keyEvent(ch.charCodeAt(0),false);await delay(40)}
}
const created=await call("POST","/computers",a,{version:1,name:"ci-input",architecture:"amd64",cpu:1,memoryMiB:512,image:"cirros-smoke"},202);
const path="/computers/"+created.result.id;
const viewers:Viewer[]=[];let keyId:string|undefined;
try{
 await call("POST",path+"/start",a,{},202);
 let ready=false;
 for(let i=0;i<72;i++){if((await call("GET",path,a)).instance?.status?.phase==="Running"){ready=true;break}await delay(5000)}
 assert.ok(ready);
 // The actual prompt is required; the optional entropy message is not.
 // Preserve bounded settling and strip only its precise known console interleave.
 const runningAt=Date.now();
 await awaitScreen(path,"evidence/input-login.png",s=>cirrosReady(s,Date.now()-runningAt),240);
 const managed=await call("POST","/keys",a,{label:"ci-controller",permission:"manage",ttlSeconds:600},201);keyId=managed.id;
 const automation=await call("POST",path+"/console-tickets",managed.token,{scope:"control-vnc"},201);
 const human=await call("POST",path+"/console-tickets",a,{scope:"control-vnc"},201);
 const observer=await call("POST",path+"/console-tickets",a,{scope:"observe-vnc"},201);
 assert.equal(automation.actor,"automation");assert.equal(human.actor,"human");
 const lease=path+"/input-lease";
 await call("POST",lease,observer.token,{},403,"Console");
 await call("GET",lease,b,undefined,404);
 const first=await call("POST",lease,automation.token,{},200,"Console");
 assert.ok(first.active);assert.equal(first.actor,"automation");
 await call("POST",lease,human.token,{},409,"Console");
 const av=await connectViewer(path,automation.token);viewers.push(av);
 const hv=await connectViewer(path,human.token);viewers.push(hv);
 const ov=await connectViewer(path,observer.token);viewers.push(ov);
 await typeText(av,"autocitest");
 const automated=await awaitScreen(path,"evidence/input-automation.png",s=>normalize(s).includes("autocitest"),15);
 assert.equal(normalize(automated).split("autocitest").length-1,1);
 assert.ok(!normalize(automated).includes("forbiddeninput")&&!normalize(automated).includes("observerinput"));
 const taken=await call("POST",lease,human.token,{takeover:true},200,"Console");
 assert.ok(taken.active);assert.equal(taken.actor,"human");assert.ok(taken.generation>first.generation);
 await call("POST",lease,automation.token,{takeover:true},409,"Console");
 await typeText(av,"forbiddeninput");
 await typeText(ov,"observerinput");
 await typeText(hv,"humancontrol");
 const final=await awaitScreen(path,"evidence/input-human.png",s=>normalize(s).includes("autocitest")&&normalize(s).includes("humancontrol"),15);
 assert.equal(normalize(final).split("autocitest").length-1,1);
 assert.equal(normalize(final).split("humancontrol").length-1,1);
 assert.ok(!normalize(final).includes("forbiddeninput"));
 assert.ok(!normalize(final).includes("observerinput"));
 assert.ok(!normalize(final).includes("batchok"));
 await call("DELETE",lease,human.token,undefined,200,"Console");
 assert.equal((await call("GET",lease,a)).active,false);
 await call("DELETE","/keys/"+keyId,a);keyId=undefined;
 await call("POST",lease,automation.token,{},401,"Console");
 // Close the human RFB transport before using the same ticket via HTTP.
 hv.client.end();hv.ws.terminate();await delay(1000);
 const input=path+"/input";
 const batch={events:[..."batchok"].flatMap(ch=>[{type:"key",keysym:ch.charCodeAt(0),down:true},{type:"key",keysym:ch.charCodeAt(0),down:false}])};
 await call("POST",input,observer.token,batch,403,"Console");
 await call("POST",input,human.token,batch,409,"Console");
 await call("POST",lease,human.token,{},200,"Console");
 const batchKey=randomUUID();
 const batchResult=await call("POST",input,human.token,batch,202,"Console",batchKey);
 assert.equal(batchResult.result.accepted,batch.events.length);
 assert.equal((await call("POST",input,human.token,batch,202,"Console",batchKey)).operationId,batchResult.operationId);
 const batchText=await awaitScreen(path,"evidence/input-http.png",s=>normalize(s).includes("batchok"),30);
 assert.equal(normalize(batchText).split("batchok").length-1,1,"HTTP batch marker appeared more than once");
 assert.ok(!normalize(batchText).includes("forbiddeninput")&&!normalize(batchText).includes("observerinput"));
 // Kernel log messages may interleave with typed text; each unique marker
 // was independently proved on the same instance. Do not require adjacency.
 await call("DELETE",lease,human.token,undefined,200,"Console");
 writeFileSync("evidence/input-ownership.json",JSON.stringify({automationVisible:true,humanTakeover:true,automationDenied:true,observerDenied:true,keyRevocation:true,httpBatchVisible:true,httpBatchReplay:true,firstGeneration:first.generation,lastGeneration:taken.generation},null,2));
 console.log("Actual guest-visible keyboard input and human takeover verified");
 // Hard reset is separately confirmed; unlike restart it keeps the VMI UID.
 const uid=(await call("GET",path,a)).instance.metadata.uid;
 await call("POST",path+"/reset",b,{confirmHardReset:true,instanceUid:uid},404);
 await call("POST",path+"/reset",a,{confirmHardReset:false,instanceUid:uid},422);
 await call("POST",path+"/reset",a,{confirmHardReset:true,instanceUid:randomUUID()},409);
 for(const v of viewers){v.client.end();v.ws.terminate()}
 const resetKey=randomUUID(),resetBody={confirmHardReset:true,instanceUid:uid};
 const reset=await call("POST",path+"/reset",a,resetBody,202,"Bearer",resetKey);
 assert.equal(reset.result.instanceUid,uid);
 await awaitScreen(path,"evidence/reset-login.png",s=>/login\s*:/i.test(s)&&!normalize(s).includes("batchok")&&!normalize(s).includes("humancontrol"),180);
 assert.equal((await call("GET",path,a)).instance.metadata.uid,uid);
 assert.equal((await call("POST",path+"/reset",a,resetBody,202,"Bearer",resetKey)).operationId,reset.operationId);
 writeFileSync("evidence/reset-verification.json",JSON.stringify({sameVmiUid:true,oldInputAbsent:true,guestLoginPromptReturned:true,crossAccountDenied:true,confirmationRequired:true,replayOperationIdStable:true},null,2));
 console.log("Actual hard reset guest login prompt returned with the same VMI UID");
}finally{
 for(const v of viewers){v.client.end();v.ws.terminate()}
 if(keyId)await call("DELETE","/keys/"+keyId,a);
 await call("DELETE",path,a,undefined,202);
}
