/** Independently verify retained native HTTP/tunnel evidence, not certify hardware. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { isMain } from "./tooling.ts";
import assert from "node:assert/strict";
type Trace={method:string;path:string;actor?:string;expected:number;status?:number;phase?:string;transport?:unknown};
const sha=(x:Buffer)=>createHash("sha256").update(x).digest("hex");
export function verify(root:string,commit:string,run:string){
 const p=JSON.parse(readFileSync(join(root,"network-verification.json"),"utf8")) as Record<string,unknown>;
 assert(/^[a-f0-9]{40}$/.test(commit)&&p.commit===commit&&p.runId===run,"Unexpected execution identity");
 assert(["nativeGuestHttp","loopbackTcpRelayVerified","clusterApiEgressBlocked","crossAccountDenied","duplicateConnectionDenied","revokedDisconnect","stopDisconnect"].every(k=>p[k]===true),"Incomplete tunnel proof");
 const marker=p.marker;assert(typeof marker==="string"&&/^network-marker-[a-f0-9-]{36}$/.test(marker),"Invalid guest marker");
 for(const [name,key] of [["guest","guestResponseSha256"],["relay","relayResponseSha256"]]){
  const raw=readFileSync(join(root,"network-"+name+"-response.txt"));
  assert(raw.length>0&&raw.length<=65536&&sha(raw)===p[key],"Guest response hash mismatch");
  const sep=raw.indexOf("\r\n\r\n");assert(sep>=0,"Missing actual HTTP 200 response");
  const header=raw.subarray(0,sep).toString("latin1").split(/\r?\n/),body=raw.subarray(sep+4);
  assert(header[0]==="HTTP/1.0 200 OK","Missing actual HTTP 200 response");
  assert(body.toString("latin1").replace(/[\r\n]+$/,"")===marker+"\ncluster-egress-blocked","Guest marker or egress mismatch");
  assert.deepEqual(header.filter(x=>x.toLowerCase().startsWith("content-length:")).map(x=>x.slice(15).trim()),[String(body.length)],"Incomplete native HTTP body");
 }
 const raw=readFileSync(join(root,"network-http.jsonl"));
 assert(sha(raw)===p.traceSha256,"Complete network trace hash mismatch");
 const rows=raw.toString("utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x) as Trace);
 assert(rows.length&&rows.every(x=>Object.keys(x).every(k=>["method","path","actor","expected","status","phase","transport"].includes(k))),"Unexpected trace fields");
 for(const x of rows){
  if(x.transport!=null)assert(x.method==="GET","Unexpected mutation transport failure");
  else if(x.status!==x.expected)assert(x.method==="WSS"&&(x.phase==="ready"&&[409,502].includes(x.status??0)||x.phase==="reconnect"&&x.status===409),"Unexpected HTTP or WSS failure");
 }
 const vm="/computers/vm-[a-f0-9]{32}",tunnel=vm+"/exposures/[a-f0-9-]{36}/connect";
 const found=(method:string,pattern:string,expected:number,actor?:string)=>rows.some(x=>x.method===method&&new RegExp("^"+pattern+"$").test(x.path)&&x.status===expected&&x.expected===expected&&(actor===undefined||x.actor===actor));
 assert(found("POST",vm+"/exposures",404,"foreign")&&found("POST",vm+"/exposures",422,"owner")&&found("POST",vm+"/exposures",201,"owner"),"Missing exposure authorization");
 assert(found("WSS",tunnel,101)&&found("WSS",tunnel,409)&&rows.filter(x=>x.method==="WSS"&&x.status===401&&x.expected===401).length>=3,"Missing WSS authorization and duplicate denial");
 assert(found("DELETE",vm+"/exposures/[a-f0-9-]{36}",200,"owner")&&found("POST",vm+"/stop",202,"owner")&&found("DELETE",vm+"\\?deleteDisks=true",202,"owner"),"Missing revoke, stop or cleanup");
 assert(found("GET","/operations/[a-f0-9-]{36}",200,"owner"),"Missing deletion observation");
 return {commit,runId:run,httpAndUpgradeCalls:rows.length,guestAndRelayResponseVerified:true,hardwareCertifiedByVerifier:false};
}
if(isMain(import.meta.url)){
 const {values}=parseArgs({options:{root:{type:"string"},commit:{type:"string"},"run-id":{type:"string"}}});
 if(!values.root||!values.commit||!values["run-id"])throw Error("--root, --commit, --run-id required");
 console.log(JSON.stringify(verify(values.root,values.commit,values["run-id"]),null,2));
}
