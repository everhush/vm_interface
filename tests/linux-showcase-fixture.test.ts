import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {APP,packageBytes,launcherCloud,verifyArchive,verifyPlatform,verifyPointerReceipt} from "../scripts/linux-showcase-fixture.ts";
import {sha} from "../scripts/api-client.ts";
import {ZipReader} from "../scripts/zip-reader.ts";
import {storedZip} from "../scripts/zip-writer.ts";
test("deterministic guest application and bounded launcher",async()=>{
 assert(packageBytes().equals(packageBytes()));const dir=mkdtempSync(join(tmpdir(),"vm-linux-"));try{const p=join(dir,"proof.zip");writeFileSync(p,packageBytes());const z=new ZipReader(p);try{assert.deepEqual(z.entries.map(v=>v.name),["proof.sh"]);assert.equal((await z.buffer(z.entries[0],65536)).toString(),APP);}finally{z.close();}
 const cloud=launcherCloud();assert(Buffer.byteLength(cloud)<=2048&&cloud.includes(sha(packageBytes()))&&cloud.split(sha(Buffer.from(APP))).length===3);execFileSync("bash",["-n"],{input:cloud});execFileSync("bash",["-n"],{input:APP});assert(cloud.includes("set -C"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("exact guest archive bytes",async()=>{const raw=storedZip([["challenge.bin",Buffer.from("actual")]]);await verifyArchive(raw,Buffer.from("actual"));await assert.rejects(verifyArchive(raw,Buffer.from("wrong")));});
test("inventory and tablet challenge",()=>{
 const p=Buffer.from(JSON.stringify({machine:"x86_64",release:"ID=fedora\nVERSION_ID=44\n"})),rpm=Buffer.from("fedora-release\t44-1\tMIT\n");verifyPlatform(p,rpm,"44");assert.throws(()=>verifyPlatform(p,rpm,"43"));assert.throws(()=>verifyPlatform(p,Buffer.from("fedora-release\t44-1\n"),"44"));
 const data=Buffer.from("actual"),v={device:"QEMU USB Tablet",absoluteX:12000,absoluteY:20000,leftPress:true,leftRelease:true,challengeSha256:sha(data)};assert.deepEqual(verifyPointerReceipt(Buffer.from(JSON.stringify(v)),data),v);
 for(const change of [{leftPress:false},{leftRelease:false},{absoluteY:-1},{absoluteX:true},{device:"keyboard"},{challengeSha256:"0".repeat(64)}])assert.throws(()=>verifyPointerReceipt(Buffer.from(JSON.stringify({...v,...change})),data));
});
