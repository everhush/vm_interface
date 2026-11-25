import {ApiError} from "./kube";
let active=0;
export async function boundedBody(req:Request,max:number,timeoutMs=30000){
 if(!req.body)return Buffer.alloc(0);
 const length=req.headers.get("content-length");
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw new ApiError(413,"Request body exceeds limit");
 if(active>=8)throw new ApiError(429,"Body receiver busy");
 const reader=req.body.getReader();active++;
 let expired=false,size=0;
 const chunks:Buffer[]=[];
 const timer=setTimeout(()=>{expired=true;void reader.cancel().catch(()=>{})},timeoutMs);
 try{
  for(;;){
   const next=await reader.read();
   if(expired)throw new ApiError(400,"Request body deadline exceeded");
   if(next.done)break;
   size+=next.value.length;
   if(size>max)throw new ApiError(413,"Request body exceeds limit");
   chunks.push(Buffer.from(next.value));
  }
  if(length!==null&&Number(length)!==size)throw new ApiError(400,"Request body length mismatch");
  return Buffer.concat(chunks,size);
 }catch(e){await reader.cancel().catch(()=>{});throw e}
 finally{clearTimeout(timer);reader.releaseLock();active--}
}
export async function boundedText(req:Request,max:number){return (await boundedBody(req,max)).toString("utf8")}
