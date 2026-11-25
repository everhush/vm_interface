/** Product API-only native guest HTTP application and private tunnel test. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {WebSocket,createWebSocketStream} from "ws";
const base=process.env.API_URL||"http://127.0.0.1:3000/api/v1";
const gateway=process.env.VNC_URL||"wss://127.0.0.1:3443/api/v1";
const a=process.env.TOKEN_A,b=process.env.TOKEN_B;
assert.ok(a&&b);
const ca=readFileSync(process.env.CONSOLE_CA_PATH||"/tmp/console-tls.crt");
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(method:string,path:string,token:string,body?:unknown,expected=200){
 const r=await fetch(base+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json","idempotency-key":randomUUID()},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,expected,method+" "+path);
 return r.json();
}
function ws(path:string,token:string){
 const s=new WebSocket(gateway+path,["binary","vm-network."+token],{ca,handshakeTimeout:15000,maxPayload:1024*1024,perMessageDeflate:false});
 s.on("error",()=>{});return s;
}
async function deny(path:string,token:string,status:number){
 const s=ws(path,token);
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Tunnel denial timeout")),20000);
  s.once("unexpected-response",(_req,res)=>{clearTimeout(timer);res.resume();try{assert.equal(res.statusCode,status);resolve()}catch(e){reject(e)}});
  s.once("open",()=>{clearTimeout(timer);reject(Error("Unauthorized tunnel opened"))});
  s.once("error",e=>{clearTimeout(timer);reject(e)});
 })}finally{s.terminate()}
}
async function open(path:string,token:string){
 const s=ws(path,token);
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Tunnel handshake timeout")),20000);
  s.once("open",()=>{clearTimeout(timer);resolve()});s.once("error",e=>{clearTimeout(timer);reject(e)});
 })}catch(e){s.terminate();throw e}
 return s;
}
async function guestHttp(path:string,token:string){
 const s=await open(path,token),stream=createWebSocketStream(s);
 try{
  stream.write("GET /marker.txt HTTP/1.0\r\nHost: guest\r\nConnection: close\r\n\r\n");
  let result="",size=0;
  const timer=setTimeout(()=>s.terminate(),10000);
  try{for await(const chunk of stream){size+=chunk.length;if(size>65536)throw Error("Oversized guest response");result+=chunk.toString();if(result.includes("network-marker-")&&result.includes("cluster-egress-"))break}}
  finally{clearTimeout(timer)}
  return result;
 }finally{stream.destroy();s.terminate()}
}
async function waitClosed(s:WebSocket){
 if(s.readyState===WebSocket.CLOSED)return;
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Revoked tunnel remained open")),10000);s.once("close",()=>{clearTimeout(timer);resolve()})});
}
const marker="network-marker-"+randomUUID();
const cloud="#!/bin/bash\nset -eu\nmkdir -p /run/netproof\nprintf '%s\\n' '"+marker+"' > /run/netproof/marker.txt\nif timeout 3 bash -c '</dev/tcp/10.43.0.1/443'; then echo cluster-egress-open; else echo cluster-egress-blocked; fi >> /run/netproof/marker.txt\nnohup python3 -m http.server 8080 --bind 0.0.0.0 --directory /run/netproof >/run/netproof/server.log 2>&1 &\n";
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
  try{response=await guestHttp(tunnel,grant.token);if(response.includes(marker))break}catch{/* guest app may still be booting */}
  await delay(2000);
 }
 assert.ok(response.includes("200 OK")&&response.includes(marker),"Actual guest application did not respond");
 assert.ok(response.includes("cluster-egress-blocked")&&!response.includes("cluster-egress-open"),"Guest could reach cluster API endpoint");
 const live=await open(tunnel,grant.token);sockets.push(live);
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
 writeFileSync("evidence/network-verification.json",JSON.stringify({nativeGuestHttp:true,marker,clusterApiEgressBlocked:true,crossAccountDenied:true,duplicateConnectionDenied:true,revokedDisconnect:true,stopDisconnect:true},null,2));
 console.log("Actual private guest HTTP tunnel, default-deny cluster egress and revocation verified");
}finally{
 for(const s of sockets)s.terminate();
 await call("DELETE",path+"?deleteDisks=true",a,undefined,202);
}
