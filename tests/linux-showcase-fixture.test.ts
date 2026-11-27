import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {randomBytes} from "node:crypto";
import {APP,packageBytes,launcherCloud,verifyArchive,verifyPlatform,verifyPointerReceipt,runtimeParts,verifyRuntime} from "../scripts/linux-showcase-fixture.ts";
import {sha} from "../scripts/api-client.ts";
import {ZipReader} from "../scripts/zip-reader.ts";
import {storedZip} from "../scripts/zip-writer.ts";
test("deterministic guest application and bounded launcher",async()=>{
 assert(packageBytes().equals(packageBytes()));const dir=mkdtempSync(join(tmpdir(),"vm-linux-"));try{const p=join(dir,"proof.zip");writeFileSync(p,packageBytes());const z=new ZipReader(p);try{assert.deepEqual(z.entries.map(v=>v.name),["proof.ts","zip-writer.ts"]);assert.equal((await z.buffer(z.entries[0],65536)).toString(),APP.replace('"../zip-writer.ts"','"./zip-writer.ts"'));}finally{z.close();}
 const runtime=runtimeParts(Buffer.from("test runtime"),"v24.1.0"),cloud=launcherCloud(runtime);assert(Buffer.byteLength(cloud)<=2048&&cloud.includes(sha(packageBytes()))&&cloud.split(runtime.executableSha256).length===3);execFileSync("bash",["-n"],{input:cloud});assert(cloud.includes("set -C")&&cloud.includes("proof.ts"));const challenge=Buffer.from("actual"),receipt=Buffer.from(JSON.stringify({node:runtime.version,architecture:"x64",executableSha256:runtime.executableSha256,challengeSha256:sha(challenge)}));verifyRuntime(receipt,challenge,runtime);assert.throws(()=>verifyRuntime(receipt,Buffer.from("wrong"),runtime));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("exact guest archive bytes",async()=>{const raw=storedZip([["challenge.bin",Buffer.from("actual")]]);await verifyArchive(raw,Buffer.from("actual"));await assert.rejects(verifyArchive(raw,Buffer.from("wrong")));});
test("inventory and tablet challenge",()=>{
 const p=Buffer.from(JSON.stringify({machine:"x86_64",release:"ID=fedora\nVERSION_ID=44\n"})),rpm=Buffer.from("fedora-release\t44-1\tMIT\n");verifyPlatform(p,rpm,"44");assert.throws(()=>verifyPlatform(p,rpm,"43"));assert.throws(()=>verifyPlatform(p,Buffer.from("fedora-release\t44-1\n"),"44"));
 const data=Buffer.from("actual"),v={device:"QEMU USB Tablet",absoluteX:12000,absoluteY:20000,leftPress:true,leftRelease:true,challengeSha256:sha(data)};assert.deepEqual(verifyPointerReceipt(Buffer.from(JSON.stringify(v)),data),v);
 for(const change of [{leftPress:false},{leftRelease:false},{absoluteY:-1},{absoluteX:true},{device:"keyboard"},{challengeSha256:"0".repeat(64)}])assert.throws(()=>verifyPointerReceipt(Buffer.from(JSON.stringify({...v,...change})),data));
});

test("runtime upload chunks are bounded and reconstruct exactly",()=>{const bytes=randomBytes(8*1024*1024),parts=runtimeParts(bytes,"v24.1.0");assert(parts.chunks.length>=2);assert(parts.chunks.every(p=>p.bytes.length<=7*1024*1024&&p.sha256===sha(p.bytes)));assert(gunzipSync(Buffer.concat(parts.chunks.map(p=>p.bytes))).equals(bytes));assert.equal(parts.executableSha256,sha(bytes));});
