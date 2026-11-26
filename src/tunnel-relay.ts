/** Bounded binary WebSocket relay. On peer EOF, queue the close frame after
 * already received payload, rather than destroying the other stream immediately.
 * Revocation, expiry, over-limit or error still abort both peers synchronously. */
import {WebSocket,type RawData} from "ws";
const MAX_BYTES=32*1024*1024,MAX_IDLE=30000,MAX_PENDING=4*1024*1024,PAUSE_PENDING=1024*1024;
function length(data:RawData){return Array.isArray(data)?data.reduce((n,b)=>n+b.byteLength,0):data.byteLength}
export function relayBinaryTunnel(client:WebSocket,source:WebSocket,expiresAt:number,authorize:()=>Promise<unknown>,onDone:()=>void){
 let closed=false,draining=false,checking=false,total=0,last=Date.now(),drainTimer:ReturnType<typeof setTimeout>|undefined;
 const abort=()=>{
  if(closed)return;
  closed=true;clearInterval(timer);if(drainTimer)clearTimeout(drainTimer);
  client.terminate();source.terminate();onDone();
 };
 const forward=(from:WebSocket,to:WebSocket,data:RawData,isBinary:boolean)=>{
  if(closed||draining)return;
  const bytes=length(data);total+=bytes;last=Date.now();
  if(!isBinary||!bytes||bytes>1024*1024||total>MAX_BYTES||last>=expiresAt||
    to.readyState!==WebSocket.OPEN||to.bufferedAmount+bytes>MAX_PENDING){abort();return}
  if(to.bufferedAmount+bytes>PAUSE_PENDING)from.pause();
  try{to.send(data,{binary:true},err=>{
   if(err){abort();return}
   if(!closed&&!draining&&from.readyState===WebSocket.OPEN&&to.bufferedAmount<PAUSE_PENDING)from.resume();
  })}catch{abort()}
 };
 const ended=(peer:WebSocket,code:number)=>{
  if(closed)return;
  if(draining||peer.readyState===WebSocket.CLOSED){abort();return}
  draining=true;
  // ws.close queues after pending data. Keep a short bounded drain deadline,
  // and never continue forwarding or extending an expired/revoked grant.
  if(peer.readyState===WebSocket.OPEN)peer.close(code===1000||code===1001?1000:1011,"Tunnel closed");
  drainTimer=setTimeout(abort,3000);
 };
 const timer=setInterval(()=>{
  if(Date.now()>=expiresAt||Date.now()-last>MAX_IDLE){abort();return}
  if(checking)return;checking=true;
  void authorize().catch(abort).finally(()=>{checking=false});
 },500);
 client.on("message",(data,binary)=>forward(client,source,data,binary));
 source.on("message",(data,binary)=>forward(source,client,data,binary));
 client.on("error",abort);source.on("error",abort);
 client.on("close",code=>ended(source,code));source.on("close",code=>ended(client,code));
 return abort;
}
