import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verify } from "../scripts/verify_network_evidence.ts";
const sha=(x:Buffer)=>createHash("sha256").update(x).digest("hex");
function fixture(root:string){
 // Synthetic unit fixture only; never published as native guest proof.
 const vm="/computers/vm-"+"a".repeat(32),grant=vm+"/exposures/"+"b".repeat(36),marker="network-marker-"+"c".repeat(36);
 const body=marker+"\ncluster-egress-blocked\n",raw=Buffer.from("HTTP/1.0 200 OK\r\nContent-Length: "+Buffer.byteLength(body)+"\r\n\r\n"+body);
 for(const name of ["guest","relay"])writeFileSync(join(root,"network-"+name+"-response.txt"),raw);
 const rows:object[]=[];
 function row(method:string,path:string,status:number,actor?:string,phase?:string,expected=status){rows.push({method,path,status,expected,...actor&&{actor},...phase&&{phase}});}
 row("POST",vm+"/exposures",404,"foreign");row("POST",vm+"/exposures",422,"owner");row("POST",vm+"/exposures",201,"owner");row("WSS",grant+"/connect",502,undefined,"ready",101);
 for(const code of [401,401,101,409,401])row("WSS",grant+"/connect",code);
 row("DELETE",grant,200,"owner");row("POST",vm+"/stop",202,"owner");row("DELETE",vm+"?deleteDisks=true",202,"owner");row("GET","/operations/"+"d".repeat(36),200,"owner");
 const trace=Buffer.from(rows.map(x=>JSON.stringify(x)+"\n").join(""));writeFileSync(join(root,"network-http.jsonl"),trace);
 const flags=Object.fromEntries(["nativeGuestHttp","loopbackTcpRelayVerified","clusterApiEgressBlocked","crossAccountDenied","duplicateConnectionDenied","revokedDisconnect","stopDisconnect"].map(k=>[k,true]));
 writeFileSync(join(root,"network-verification.json"),JSON.stringify({...flags,commit:"a".repeat(40),runId:"123",marker,guestResponseSha256:sha(raw),relayResponseSha256:sha(raw),traceSha256:sha(trace)}));
}
test("complete and tampered network trace",()=>{
 const root=mkdtempSync(join(tmpdir(),"vm-network-"));
 try{fixture(root);assert(verify(root,"a".repeat(40),"123").guestAndRelayResponseVerified);appendFileSync(join(root,"network-http.jsonl"),"{}\n");assert.throws(()=>verify(root,"a".repeat(40),"123"),/trace hash/);}finally{rmSync(root,{recursive:true,force:true});}
});
test("tampered response rejected",()=>{
 const root=mkdtempSync(join(tmpdir(),"vm-network-"));
 try{fixture(root);writeFileSync(join(root,"network-relay-response.txt"),"not guest evidence");assert.throws(()=>verify(root,"a".repeat(40),"123"),/response hash/);}finally{rmSync(root,{recursive:true,force:true});}
});
