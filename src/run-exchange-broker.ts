import {createServer} from "node:http";
import {timingSafeEqual} from "node:crypto";
import {ApiError} from "./kube";
import {exchangeFileName,MAX_FILE_BYTES} from "./exchange";
import {publish,download,listFiles} from "./exchange-files";
const root="/exchange",token=process.env.EXCHANGE_TOKEN;
if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("Missing broker token");
const expected=Buffer.from("Bearer "+token);
let active=0;
const server=createServer((req,res)=>{
 const actual=Buffer.from(req.headers.authorization??"");
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401);res.end();return}
 if(active>=2){res.writeHead(409);res.end();return}
 active++;
 void (async()=>{
  try{
   const m=/^\/files\/([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/.exec(req.url??"");
   if(req.method==="GET"&&req.url==="/files"){const files=await listFiles(root);res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(files));return}
   if(!m)throw new ApiError(404,"Not found");
   const name=exchangeFileName(m[1]);
   if(req.method==="GET"){
    const f=await download(root,name);res.writeHead(200,{"content-type":"application/octet-stream","content-length":f.bytes.length,"x-content-sha256":f.sha256,"content-disposition":"attachment; filename=\""+name+"\""});res.end(f.bytes);return;
   }
   if(req.method==="PUT"){
    const digest=req.headers["x-content-sha256"];
    if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest))throw new ApiError(422,"Checksum required");
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>MAX_FILE_BYTES)throw new ApiError(413,"File too large");chunks.push(b)}
    const data=await publish(root,name,Buffer.concat(chunks),digest);
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));return;
   }
   throw new ApiError(404,"Not found");
  }catch(e){if(!res.headersSent)res.writeHead(e instanceof ApiError?e.status:502,{"content-type":"application/json"});res.end(JSON.stringify({error:"Exchange request failed"}))}
  finally{active--}
 })();
});
server.requestTimeout=15000;server.headersTimeout=5000;
server.listen(8080,"0.0.0.0");
