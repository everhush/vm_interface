import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {createServer,type ServerResponse,type IncomingMessage} from "node:http";
import {once} from "node:events";
import {createHash} from "node:crypto";
import {binaryRequest} from "../scripts/media-http.ts";
test("full body and early response",async()=>{
 const reply=(r:ServerResponse,status:number,value:unknown)=>{const b=Buffer.from(JSON.stringify(value));r.writeHead(status,{"Content-Length":b.length,"Content-Type":"application/json",Connection:"close"});r.end(b);};
 const handle=async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url==="/early"){reply(res,409,{error:"immutable"});return;}
  const chunks:Buffer[]=[];for await(const b of req)chunks.push(Buffer.from(b));const raw=Buffer.concat(chunks);
  reply(res,202,{sha256:createHash("sha256").update(raw).digest("hex"),bytes:raw.length});
 };
 const server=createServer((req,res)=>void handle(req,res).catch(()=>res.destroy()));
 server.on("checkContinue",(req,res)=>{if(req.url==="/denied")reply(res,404,{error:"not found"});else{res.writeContinue();void handle(req,res).catch(()=>res.destroy());}});
 server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert(address&&typeof address!=="string");
 const raw=Buffer.alloc(12*1024**2,122),headers={Authorization:"Bearer test","Content-Type":"application/octet-stream",Connection:"close"};
 try{for(const [path,expected] of [["/denied",404],["/early",409],["/valid",202]] as const){const [status,body]=await binaryRequest("http://127.0.0.1:"+address.port+path,"PUT",headers,raw);assert.equal(status,expected);if(expected===202)assert.deepEqual(JSON.parse(body.toString()),{sha256:createHash("sha256").update(raw).digest("hex"),bytes:raw.length});}}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
