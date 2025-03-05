import {readFileSync} from "node:fs";
import {createServer} from "node:https";
import {createServer as createHttpServer,type IncomingMessage} from "node:http";
import {batchSpec,validateBatchGeometry,type InputBatch} from "./input-batch";
import type {Duplex} from "node:stream";
import {WebSocket,WebSocketServer,createWebSocketStream} from "ws";
import {connect,Framebuffer,RfbServerConnection,encodings,pixelFormats,type RfbClient} from "rfb2";
import {lookupDisplayTicket,displayToken} from "./console-tickets";
import {runningDisplay} from "./screenshot";
import {ApiError} from "./kube";
import {withInputAuthority} from "./input-lease";
import {HeldInput} from "./input-state";

const MAX_SESSIONS=4, MAX_VIEWERS=4, MAX_PIXELS=1920*1200;
const MAX_BUFFER=12*1024*1024;
type Grant=Awaited<ReturnType<typeof lookupDisplayTicket>>;
type Session={client:RfbClient;frame:Framebuffer;viewers:Set<WebSocket>;controlTickets:Set<string>;closed:boolean;key:string;reservations:number;input:HeldInput;queue:Promise<void>;queued:number;reconcile?:ReturnType<typeof setInterval>};
const sessions=new Map<string,Promise<Session>>();
export function gatewayTicket(req:Pick<IncomingMessage,"headers">){
 const fromHeader=displayToken(req.headers.authorization??null);
 const protocols=typeof req.headers["sec-websocket-protocol"]==="string"?req.headers["sec-websocket-protocol"].split(",").map(x=>x.trim()):[];
 const matches=protocols.filter(p=>/^vm-ticket\.[A-Za-z0-9_-]{43}$/.test(p));
 const fromProtocol=matches.length===1?matches[0].slice("vm-ticket.".length):null;
 if(matches.length>1||fromHeader&&fromProtocol&&fromHeader!==fromProtocol)return null;
 return fromHeader??fromProtocol;
}
export function dimensionsOkay(width:number,height:number){
 return Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=1920&&height<=1200&&width*height<=MAX_PIXELS;
}
function within<T>(p:Promise<T>,ms:number,onTimeout:()=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{onTimeout();reject(new ApiError(502,"Console deadline exceeded"));},ms);
  p.then(x=>{clearTimeout(timer);resolve(x)},e=>{clearTimeout(timer);reject(e)});
 });
}
function closeSession(s:Session){
 if(s.closed)return;
 s.closed=true;sessions.delete(s.key);
 if(s.reconcile)clearInterval(s.reconcile);
 try{s.input.release(s.client)}catch{/* connection already lost */}
 for(const viewer of s.viewers)viewer.close(1011,"Display disconnected");
 s.client.end();
}
function enqueue(s:Session,task:()=>Promise<void>){
 if(s.closed)return;
 if(s.queued>=128){closeSession(s);return}
 s.queued++;
 s.queue=s.queue.then(async()=>{if(!s.closed)await task()}).catch(()=>closeSession(s)).finally(()=>{s.queued--});
}
function allowedScope(scope:string){return scope==="observe-vnc"||scope==="control-vnc"}
async function openSession(id:string,grant:Grant,key:string):Promise<Session>{
 const dir="/var/run/secrets/kubernetes.io/serviceaccount/";
 const ns=process.env.VM_NAMESPACE||"vm-interface";
 const url="wss://kubernetes.default.svc/apis/subresources.kubevirt.io/v1/namespaces/"+ns+"/virtualmachineinstances/"+id+"/vnc?preserveSession=true";
 // KubeVirt v1.9 virtctl uses the standard binary websocket stream.
 const upstream=new WebSocket(url,"plain.kubevirt.io",{ca:readFileSync(dir+"ca.crt"),headers:{authorization:"Bearer "+readFileSync(dir+"token","utf8").trim()},handshakeTimeout:10000,maxPayload:MAX_BUFFER,perMessageDeflate:false});
 upstream.on("error",()=>{});
 const stream=createWebSocketStream(upstream);
 stream.on("error",()=>{});
 let client:RfbClient|undefined;
 try{
  client=await within(connect({stream,security:[1],encodings:[encodings.raw,encodings.copyRect,encodings.pseudoDesktopSize],pixelFormat:"bgrx",initialUpdate:false,timeout:10000}),15000,()=>upstream.terminate());
  if(!dimensionsOkay(client.width,client.height))throw new ApiError(422,"Display resolution exceeds gateway limit");
  if(await runningDisplay(id,grant.account)!==grant.instanceUid)throw new ApiError(409,"Display instance changed");
  const frame=new Framebuffer(client.width,client.height,client.pixelFormat);
  const s:Session={client,frame,viewers:new Set(),controlTickets:new Set(),closed:false,key,reservations:0,input:new HeldInput(),queue:Promise.resolve(),queued:0};
  // Validate resize before allocating a new framebuffer.
  client.on("rect",rect=>{
   if(s.closed)return;
   if((rect.type==="desktopSize"||rect.type==="extendedDesktopSize")&&!dimensionsOkay(rect.width,rect.height)){closeSession(s);return}
   try{frame.apply(rect)}catch{closeSession(s)}
  });
  client.on("error",()=>closeSession(s));
  client.on("close",()=>closeSession(s));
  client.on("resize",()=>{if(!dimensionsOkay(client!.width,client!.height))closeSession(s)});
  const first=client.nextUpdate();
  client.requestUpdate(false);
  await within(first,10000,()=>closeSession(s));
  if(s.closed)throw new ApiError(502,"Display disconnected");
  // Expiry/revocation releases held keys even if the old controller sends nothing.
  s.reconcile=setInterval(()=>{
   if(!s.input.owner||s.queued||s.closed)return;
   enqueue(s,async()=>{
    const owner=s.input.owner;if(!owner)return;
    const allowed=await withInputAuthority(owner.token,id,grant.instanceUid,lease=>{
     if(lease.generation!==owner.generation)s.input.release(s.client);
    });
    if(!allowed)s.input.release(s.client);
   });
  },250);
  // One upstream RFB client feeds all downstream observers. No pixel persistence.
  void (async()=>{try{
   while(!s.closed){
    await new Promise(resolve=>setTimeout(resolve,200));
    if(s.closed)break;
    const next=s.client.nextUpdate();s.client.requestUpdate(false);
    await within(next,10000,()=>closeSession(s));
   }
  }catch{closeSession(s)}})();
  return s;
 }catch(e){client?.end();upstream.terminate();throw e;}
}
async function sessionFor(id:string,g:Grant){
 const key=g.account+":"+id+":"+g.instanceUid;
 let pending=sessions.get(key);
 if(!pending){
  if(sessions.size>=MAX_SESSIONS)throw new ApiError(409,"Gateway session limit exceeded");
  pending=openSession(id,g,key);
  sessions.set(key,pending);
  void pending.catch(()=>{if(sessions.get(key)===pending)sessions.delete(key)});
 }
 const s=await pending;
 if(s.closed||s.viewers.size+s.reservations>=MAX_VIEWERS)throw new ApiError(409,"Display viewer limit exceeded");
 if(g.scope==="control-vnc"){
  if(s.controlTickets.has(g.id))throw new ApiError(409,"Control ticket already connected");
  s.controlTickets.add(g.id);
 }
 s.reservations++;
 return s;
}
function reject(socket:Duplex,status:number){
 if(!socket.destroyed)socket.end("HTTP/1.1 "+status+" Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}
function attachViewer(ws:WebSocket,s:Session,id:string,token:string,g:Grant){
 s.reservations--;s.viewers.add(ws);
 const stream=createWebSocketStream(ws);stream.on("error",()=>{});
 const conn=new RfbServerConnection(stream,{width:s.frame.width,height:s.frame.height,pixelFormat:pixelFormats.bgrx,name:"VM Interface display"});
 let closed=false,checking=false,requested=false,events=0,windowStart=Date.now();
 const finish=()=>{
  if(closed)return;closed=true;clearInterval(timer);s.viewers.delete(ws);s.controlTickets.delete(g.id);
  if(s.input.owner?.ticketId===g.id)enqueue(s,async()=>{if(s.input.owner?.ticketId===g.id)s.input.release(s.client)});
  conn.destroy();if(ws.readyState!==WebSocket.CLOSED)ws.terminate();
  if(s.viewers.size===0&&s.reservations===0)closeSession(s);
 };
 function forward(send:()=>boolean){
  if(closed||g.scope!=="control-vnc")return;
  const now=Date.now();if(now-windowStart>=1000){windowStart=now;events=0}
  if(++events>100){finish();return}
  enqueue(s,async()=>{
   if(closed)return;
   const allowed=await withInputAuthority(token,id,g.instanceUid,lease=>{
    if(closed||s.closed)return;
    s.input.select(s.client,{ticketId:g.id,generation:lease.generation,token});
    if(!send())throw new ApiError(422,"Unsupported input event");
   });
   if(!allowed&&s.input.owner?.ticketId===g.id)s.input.release(s.client);
  });
 }
 conn.on("key",event=>forward(()=>s.input.key(s.client,event.keysym,event.down)));
 conn.on("pointer",event=>forward(()=>s.input.pointer(s.client,event.x,event.y,event.buttons,s.frame.width,s.frame.height)));
 // Clipboard and every unsupported RFB extension remain disabled.
 conn.on("clipboard",()=>{});
 conn.on("updateRequest",()=>{requested=true});
 conn.on("error",finish);conn.on("close",finish);ws.on("close",finish);ws.on("error",finish);
 const timer=setInterval(()=>{
  if(closed||checking)return;checking=true;
  void (async()=>{
   try{
    const current=await lookupDisplayTicket(token,id);
    if(!allowedScope(current.scope)||current.instanceUid!==g.instanceUid||s.closed){finish();return}
    if(!requested)return;
    if(ws.bufferedAmount+stream.writableLength>MAX_BUFFER){finish();return}
    const width=s.frame.width,height=s.frame.height;
    if(!dimensionsOkay(width,height)){finish();return}
    requested=false;
    const rects:Parameters<RfbServerConnection["sendUpdate"]>[0][number][]=[];
    if(conn.width!==width||conn.height!==height){
     if(!conn.clientEncodings.includes(encodings.pseudoDesktopSize)){finish();return}
     rects.push({type:"desktopSize",width,height});
    }
    rects.push({type:"pixels",x:0,y:0,width,height,data:s.frame.data});
    conn.sendUpdate(rects);
   }catch{finish()}finally{checking=false}
  })();
 },250);
}
async function acceptBatch(id:string,token:string,batch:InputBatch){
 const g=await lookupDisplayTicket(token,id);
 if(g.scope!=="control-vnc")throw new ApiError(403,"Control ticket required");
 if(await runningDisplay(id,g.account)!==g.instanceUid)throw new ApiError(409,"Stale display instance");
 const s=await sessionFor(id,g);
 try{
  if(s.queued>=128)throw new ApiError(409,"Console busy");
  s.queued++;
  let cancelled=false;
  const work=s.queue.then(async()=>{
   if(cancelled||s.closed)throw new ApiError(502,"Display disconnected");
   validateBatchGeometry(batch,s.frame.width,s.frame.height);
   let generation=0;
   const allowed=await withInputAuthority(token,id,g.instanceUid,lease=>{
    if(cancelled||s.closed)throw new ApiError(502,"Display disconnected");
    // HTTP batches are self-contained: release all previous held input,
    // transmit under the same fence as RFB and release at batch end.
    s.input.release(s.client);
    s.input.select(s.client,{ticketId:g.id,generation:lease.generation,token});
    try{
     for(const event of batch.events){
      const accepted=event.type==="key"?s.input.key(s.client,event.keysym,event.down):s.input.pointer(s.client,event.x,event.y,event.buttons,s.frame.width,s.frame.height);
      if(!accepted)throw new ApiError(502,"Input partially submitted");
     }
     generation=lease.generation;
    }finally{s.input.release(s.client)}
   });
   if(!allowed)throw new ApiError(409,"Input lease not held");
   return {accepted:batch.events.length,generation};
  });
  s.queue=work.then(()=>{},()=>{}).finally(()=>{s.queued--});
  return await within(work,5000,()=>{cancelled=true;closeSession(s)});
 }finally{
  s.reservations--;s.controlTickets.delete(g.id);
  if(s.viewers.size===0&&s.reservations===0)closeSession(s);
 }
}
function startBatchListener(){
 const server=createHttpServer((req,res)=>{
  void (async()=>{
   try{
    const m=/^\/input\/(vm-[a-f0-9]{32})$/.exec(req.url??"");
    if(req.method!=="POST"||!m)throw new ApiError(404,"Not found");
    const token=displayToken(req.headers.authorization??null);
    if(!token)throw new ApiError(401,"Control ticket required");
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>16384)throw new ApiError(413,"Input batch too large");chunks.push(b)}
    let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw new ApiError(400,"Invalid JSON")}
    const parsed=batchSpec.safeParse(raw);if(!parsed.success)throw new ApiError(422,"Invalid input batch");
    const result=await acceptBatch(m[1],token,parsed.data);
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(result));
   }catch(e){res.writeHead(e instanceof ApiError?e.status:502,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({error:"Input batch unavailable"}))}
  })();
 });
 server.requestTimeout=30000;server.headersTimeout=5000;
 server.listen(3444,"127.0.0.1");
 return server;
}

export function startGateway(){
 const batchListener=startBatchListener();
 const server=createServer({key:readFileSync("/var/run/console-tls/tls.key"),cert:readFileSync("/var/run/console-tls/tls.crt"),minVersion:"TLSv1.2"},(_req,res)=>{res.writeHead(404);res.end()});
 const wss=new WebSocketServer({noServer:true,maxPayload:64*1024,perMessageDeflate:false,handleProtocols:p=>p.has("binary")?"binary":false});
 server.on("upgrade",(req,socket,head)=>{
  socket.on("error",()=>socket.destroy());
  void (async()=>{
   let s:Session|undefined,grantId:string|undefined;
   try{
    const m=/^\/api\/v1\/computers\/(vm-[a-f0-9]{32})\/vnc$/.exec(req.url??"");
    if(!m){reject(socket,404);return}
    const origin=req.headers.origin;
    if(origin&&origin!==process.env.CONSOLE_ALLOWED_ORIGIN){reject(socket,403);return}
    const token=gatewayTicket(req);
    if(!token){reject(socket,401);return}
    const g=await lookupDisplayTicket(token,m[1]);grantId=g.id;
    if(!allowedScope(g.scope)){reject(socket,403);return}
    if(await runningDisplay(m[1],g.account)!==g.instanceUid){reject(socket,409);return}
    s=await sessionFor(m[1],g);
    if(socket.destroyed){s.reservations--;s.controlTickets.delete(g.id);if(s.viewers.size===0&&s.reservations===0)closeSession(s);return}
    const session=s;
    wss.handleUpgrade(req,socket,head,ws=>attachViewer(ws,session,m[1],token,g));
   }catch(e){
    if(s){s.reservations--;if(grantId)s.controlTickets.delete(grantId);if(s.viewers.size===0&&s.reservations===0)closeSession(s)}
    reject(socket,e instanceof ApiError?e.status:502);
   }
  })();
 });
 server.on("close",()=>batchListener.close());
 server.listen(3443,"0.0.0.0");
 return server;
}
