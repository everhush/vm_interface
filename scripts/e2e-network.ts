/** Product API-only native guest HTTP application and private tunnel test. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,appendFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {randomUUID} from "node:crypto";
import {WebSocket,createWebSocketStream} from "ws";
import {startGuestRelay} from "./guest-tcp-relay";
import {connect} from "node:net";
const base=process.env.API_URL||"http://127.0.0.1:3000/api/v1";
const gateway=process.env.VNC_URL||"wss://127.0.0.1:3443/api/v1";
const a=process.env.TOKEN_A,b=process.env.TOKEN_B;
assert.ok(a&&b);
const ca=readFileSync(process.env.CONSOLE_CA_PATH||"/tmp/console-tls.crt");
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const tracePath="evidence/network-http.jsonl";
writeFileSync(tracePath,"");
function log(entry:Record<string,unknown>){
 appendFileSync(tracePath,JSON.stringify(entry)+"\n");
 console.log("Network proof",JSON.stringify(entry));
}
async function call(method:string,path:string,token:string,body?:unknown,expected=200){
 for(let i=0;i<8;i++){
  let r:Response;
  try{r=await fetch(base+path,{method,headers:{connection:"close",authorization:"Bearer "+token,"content-type":"application/json","idempotency-key":randomUUID()},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})}
  catch(e){
   log({method,path,actor:token===a?"owner":"foreign",expected,transport:e instanceof Error?e.name:"unknown"});
   if(method!=="GET"||i===7)throw e;
   await delay(2000);continue;
  }
  log({method,path,actor:token===a?"owner":"foreign",expected,status:r.status});
  assert.equal(r.status,expected,method+" "+path);
  return r.json();
 }
 throw Error("Read transport did not recover");
}
function ws(path:string,token:string){
 const s=new WebSocket(gateway+path,["binary","vm-network."+token],{ca,handshakeTimeout:15000,maxPayload:1024*1024,perMessageDeflate:false});
 s.on("error",()=>{});return s;
}
async function deny(path:string,token:string,status:number){
 const s=ws(path,token);
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Tunnel denial timeout")),20000);
  s.once("unexpected-response",(_req,res)=>{clearTimeout(timer);res.resume();log({method:"WSS",path,expected:status,status:res.statusCode});try{assert.equal(res.statusCode,status);resolve()}catch(e){reject(e)}});
  s.once("open",()=>{clearTimeout(timer);reject(Error("Unauthorized tunnel opened"))});
  s.once("error",e=>{clearTimeout(timer);reject(e)});
 })}finally{s.terminate()}
}
class TunnelHandshakeError extends Error{constructor(readonly status:number){super("Guest tunnel handshake HTTP "+status)}}
async function open(path:string,token:string,phase:"ready"|"reconnect"|"required"="required"){
 const s=ws(path,token);
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Tunnel handshake timeout")),20000);
  s.once("open",()=>{clearTimeout(timer);log({method:"WSS",path,phase,expected:101,status:101});resolve()});s.once("error",e=>{clearTimeout(timer);reject(e)});s.once("unexpected-response",(_req,res)=>{clearTimeout(timer);res.resume();log({method:"WSS",path,phase,expected:101,status:res.statusCode});reject(new TunnelHandshakeError(res.statusCode??502))});
 })}catch(e){s.terminate();throw e}
 return s;
}
async function reopen(path:string,token:string){
 // Only an explicit 409 after this client's known prior connection closed
 // can be retried; other authorization errors remain failures.
 const deadline=Date.now()+6000;
 for(;;){try{return await open(path,token,"reconnect")}catch(e){
  if(!(e instanceof TunnelHandshakeError)||e.status!==409||Date.now()>=deadline)throw e;
  await delay(250);
 }}
}
async function guestHttp(path:string,token:string){
 const s=await open(path,token,"ready"),stream=createWebSocketStream(s);
 try{
  stream.write("GET /marker.txt HTTP/1.0\r\nHost: guest\r\nConnection: close\r\n\r\n");
  let result="",size=0;
  const timer=setTimeout(()=>s.terminate(),10000);
  try{for await(const chunk of stream){size+=chunk.length;if(size>65536)throw Error("Oversized guest response");result+=chunk.toString()}}
  finally{clearTimeout(timer)}
  return result;
 }finally{stream.destroy();s.terminate()}
}
async function waitClosed(s:WebSocket){
 if(s.readyState===WebSocket.CLOSED)return;
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Revoked tunnel remained open")),10000);s.once("close",()=>{clearTimeout(timer);resolve()})});
}
const marker="network-marker-"+randomUUID();
const cloud="#!/bin/bash\nset -eu\nmkdir -p /run/netproof\nprintf '%s\\n' '__MARKER__' > /run/netproof/marker.txt\nif timeout 3 bash -c '</dev/tcp/10.43.0.1/443'; then echo cluster-egress-open; else echo cluster-egress-blocked; fi >> /run/netproof/marker.txt\ncat >/run/netproof/serve <<'SH'\n#!/bin/bash\nset -eu\nIFS= read -r -t 3 line\ncase \"$line\" in \"GET /marker.txt HTTP/1.0\"*) ;; *) exit 1;; esac\nfor i in $(seq 1 32); do\n  IFS= read -r -t 3 line\n  if [ \"$line\" = \"$(printf '\\r')\" ]; then break; fi\ndone\nf=/run/netproof/marker.txt\nprintf 'HTTP/1.0 200 OK\\r\\nContent-Length: %s\\r\\nContent-Type: text/plain\\r\\nConnection: close\\r\\n\\r\\n' \"$(stat -c %s \"$f\")\"\ncat \"$f\"\nSH\nchmod 755 /run/netproof/serve\nsystemd-run --unit=vm-netproof --property=Type=exec /usr/bin/ncat -l -k -p 8080 --exec /run/netproof/serve\n".replace("__MARKER__",marker);
const spec={version:1,name:"ci-network",architecture:"amd64",cpu:1,memoryMiB:1536,image:"fedora-exchange-test",storage:{systemGiB:8,exchangeGiB:1,exchangeMode:"virtiofs"},network:"private",cloudInit:cloud};
const created=await call("POST","/computers",a,spec,202);
const path="/computers/"+created.result.id,collection=path+"/exposures";
const sockets:WebSocket[]=[];
try{
 await call("POST",path+"/start",a,{},202);
 let ready=false;
 for(let i=0;i<120;i++){if((await call("GET",path,a)).instance?.status?.phase==="Running"){ready=true;break}await delay(5000)}
 assert.ok(ready);
 const grantSpec={port:8080,ttlSeconds:600,access:"private-tunnel"};
 await call("POST",collection,b,grantSpec,404);
 await call("POST",collection,a,{...grantSpec,access:"public"},422);
 const grant=await call("POST",collection,a,grantSpec,201);
 assert.equal(grant.port,8080);
 const tunnel=path+"/exposures/"+grant.id+"/connect";
 await deny(tunnel,"a".repeat(43),401);
 await deny("/computers/vm-"+"0".repeat(32)+"/exposures/"+grant.id+"/connect",grant.token,401);
 let response="";
 for(let i=0;i<60;i++){
  try{response=await guestHttp(tunnel,grant.token);if(response.includes(marker))break}catch(e){if(i%10===0)console.log("Guest tunnel attempt",i,e instanceof Error?e.message:"unknown")}
  await delay(2000);
 }
 writeFileSync("evidence/network-guest-response.txt",response);
 assert.ok(response.includes("200 OK")&&response.includes(marker),"Actual guest application did not respond");
 assert.ok(response.includes("cluster-egress-blocked")&&!response.includes("cluster-egress-open"),"Guest could reach cluster API endpoint");
 // The same loopback TCP relay used by the Android client must work
 // against this actual guest application, not just a local echo fixture.
 const adapter=await startGuestRelay(gateway+tunnel,grant.token,ca);
 try{
  const actual=await new Promise<string>((resolve,reject)=>{
   const socket=connect(adapter.port,"127.0.0.1");
   let data="";
   const timer=setTimeout(()=>{socket.destroy();reject(Error("Guest relay timeout"))},15000);
   socket.on("connect",()=>socket.write("GET /marker.txt HTTP/1.0\r\nHost: guest\r\nConnection: close\r\n\r\n"));
   socket.on("data",chunk=>{data+=chunk.toString();if(data.length>65536){socket.destroy();clearTimeout(timer);reject(Error("Oversized relay response"))}else if(data.includes(marker+"\ncluster-egress-blocked\n")){clearTimeout(timer);resolve(data);socket.end()}});
   socket.on("error",e=>{clearTimeout(timer);reject(e)});
   socket.on("close",()=>{clearTimeout(timer);if(!data.includes(marker)||!data.includes("cluster-egress-blocked"))reject(Error("Guest relay response incomplete"))});
  });
  writeFileSync("evidence/network-relay-response.txt",actual);
  assert.ok(actual.includes("200 OK")&&actual.includes(marker)&&actual.includes("cluster-egress-blocked"));
 }finally{await adapter.close()}
 await delay(1000);
 const live=await reopen(tunnel,grant.token);sockets.push(live);
 await deny(tunnel,grant.token,409);
 await call("DELETE",collection+"/"+grant.id,a);
 await waitClosed(live);
 await deny(tunnel,grant.token,401);
 const second=await call("POST",collection,a,grantSpec,201);
 const secondPath=path+"/exposures/"+second.id+"/connect",s=await open(secondPath,second.token);sockets.push(s);
 await call("POST",path+"/stop",a,{},202);
 await waitClosed(s);
 const grants=await call("GET",collection,a);
 assert.equal(grants.find((g:{id:string})=>g.id===second.id).active,false);

}finally{
 for(const s of sockets)s.terminate();
 const deleted=await call("DELETE",path+"?deleteDisks=true",a,undefined,202);
 const deadline=Date.now()+300000;
 let converged=false;
 while(Date.now()<deadline){
  const receipt=await call("GET","/operations/"+deleted.operationId,a);
  if(receipt.observation?.state==="converged"){converged=true;break}
  await delay(3000);
 }
 assert.ok(converged,"Network fixture deletion did not converge");
}
writeFileSync("evidence/network-verification.json",JSON.stringify({nativeGuestHttp:true,loopbackTcpRelayVerified:true,marker,clusterApiEgressBlocked:true,crossAccountDenied:true,duplicateConnectionDenied:true,revokedDisconnect:true,stopDisconnect:true,commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,guestResponseSha256:createHash("sha256").update(readFileSync("evidence/network-guest-response.txt")).digest("hex"),relayResponseSha256:createHash("sha256").update(readFileSync("evidence/network-relay-response.txt")).digest("hex"),traceSha256:createHash("sha256").update(readFileSync(tracePath)).digest("hex")},null,2));
console.log("Actual private guest HTTP tunnel, default-deny cluster egress and revocation verified");
