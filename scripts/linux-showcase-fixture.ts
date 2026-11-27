/** Reproducible TypeScript guest archive and bounded runtime provisioning. */
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {gzipSync} from "node:zlib";
import {storedZip} from "./zip-writer.ts";
import {ZipReader} from "./zip-reader.ts";
import {sha} from "./api-client.ts";
export const APP=readFileSync(new URL("./guest/linux-proof.ts",import.meta.url),"utf8");
const WRITER=readFileSync(new URL("./zip-writer.ts",import.meta.url));
// The guest application imports its own shipped copy, not a host service.
export const packageBytes=()=>storedZip([["proof.ts",Buffer.from(APP.replace('"../zip-writer.ts"','"./zip-writer.ts"'))],["zip-writer.ts",Buffer.from(WRITER)]]);
export const CLOUD="#!/bin/bash\nset -eu\nmkdir -p /mnt/exchange\ncat >/usr/local/bin/proof-launch <<'SH'\n#!/bin/bash\nset -eu\nd=/usr/local/lib/vm-interface-proof\nn=$d/node\np=$d/proof.ts\nz=/mnt/exchange/in-proof.zip\nmkdir -p \"$d\"\nif ! test -f \"$n\"; then\n cat /mnt/exchange/in-runtime-*.part | gzip -dc > \"$n.tmp\"\n echo '__RUNTIME_SHA__  '\"$n.tmp\" | sha256sum -c -\n chmod 755 \"$n.tmp\"\n mv \"$n.tmp\" \"$n\"\nfi\necho '__RUNTIME_SHA__  '\"$n\" | sha256sum -c -\ntest \"$(\"$n\" -p 'process.version')\" = '__RUNTIME_VERSION__'\necho '__PACKAGE_SHA__  '\"$z\" | sha256sum -c -\ntest \"$(unzip -Z1 \"$z\")\" = \"$(printf 'proof.ts\\nzip-writer.ts')\"\nunzip -tq \"$z\"\nif test -f \"$p\"; then\n unzip -p \"$z\" proof.ts | cmp - \"$p\"\n unzip -p \"$z\" zip-writer.ts | cmp - \"$d/zip-writer.ts\"\n \"$n\" \"$p\" --verify-clone\nelse\n echo proofready\n echo 'Type runproof then Enter'\n read -r cmd\n test \"$cmd\" = runproof\n (umask 022; set -C; unzip -p \"$z\" proof.ts > \"$p\"; unzip -p \"$z\" zip-writer.ts > \"$d/zip-writer.ts\")\n \"$n\" \"$p\"\nfi\nsleep 180\nSH\nchmod 755 /usr/local/bin/proof-launch\ncat >/etc/systemd/system/vm-interface-proof.service <<'UNIT'\n[Unit]\nConflicts=getty@tty1.service\nAfter=systemd-user-sessions.service\n[Service]\nExecStartPre=/usr/bin/mount -t virtiofs exchange /mnt/exchange\nExecStart=/usr/local/bin/proof-launch\nStandardInput=tty-force\nStandardOutput=tty\nStandardError=tty\nTTYPath=/dev/tty1\nTTYReset=yes\nTTYVHangup=yes\n[Install]\nWantedBy=multi-user.target\nUNIT\nsystemctl daemon-reload\nsystemctl enable vm-interface-proof.service\nsystemctl stop getty@tty1.service\nsystemctl start --no-block vm-interface-proof.service\nchvt 1\n";
export function runtimeParts(executable=readFileSync(process.execPath),version=process.version){
 assert(/^v24\.\d+\.\d+$/.test(version)&&executable.length>0&&executable.length<=256*1024*1024,"Expected bounded Node 24 runtime");
 const compressed=gzipSync(executable,{level:1});assert(compressed.length<=128*1024*1024);
 const chunks:{name:string;bytes:Buffer;sha256:string}[]=[];
 for(let offset=0;offset<compressed.length;offset+=7*1024*1024){const bytes=compressed.subarray(offset,offset+7*1024*1024);chunks.push({name:"runtime-"+String(chunks.length).padStart(3,"0")+".part",bytes,sha256:sha(bytes)});}
 return {version,executableSha256:sha(executable),executableBytes:executable.length,compressedSha256:sha(compressed),compressedBytes:compressed.length,chunks};
}
export function launcherCloud(runtime:{version:string;executableSha256:string}){
 assert(/^v24\.\d+\.\d+$/.test(runtime.version)&&/^[a-f0-9]{64}$/.test(runtime.executableSha256));
 const value=CLOUD.replace("__PACKAGE_SHA__",sha(packageBytes())).replaceAll("__RUNTIME_SHA__",runtime.executableSha256).replace("__RUNTIME_VERSION__",runtime.version);assert(Buffer.byteLength(value)<=2048,"KubeVirt inline cloud-init limit");return value;
}
export function verifyRuntime(raw:Buffer,challenge:Buffer,runtime:{version:string;executableSha256:string}){
 assert.deepEqual(JSON.parse(raw.toString("utf8")),{node:runtime.version,architecture:"x64",executableSha256:runtime.executableSha256,challengeSha256:sha(challenge)});
}
export async function verifyArchive(raw:Buffer,challenge:Buffer){
 assert(raw.length<=64*1024*1024);
 const dir=mkdtempSync(join(tmpdir(),"vm-linux-archive-")),path=join(dir,"archive.zip");try{writeFileSync(path,raw);const z=new ZipReader(path);try{assert(z.entries.length===1&&z.entries[0].name==="challenge.bin"&&z.entries[0].size===challenge.length,"Unexpected guest archive");assert((await z.buffer(z.entries[0],challenge.length)).equals(challenge),"Guest archive did not preserve the actual challenge bytes");}finally{z.close();}}finally{rmSync(dir,{recursive:true,force:true});}
}
export function verifyPlatform(platformRaw:Buffer,rpmRaw:Buffer,version:string){
 const platform=JSON.parse(platformRaw.toString("utf8"));assert(platform.machine==="x86_64","Unexpected guest architecture");
 const pairs=Object.fromEntries(String(platform.release??"").split(/\r?\n/).filter(x=>x.includes("=")&&!x.startsWith("#")).map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1).replace(/^"|"$/g,"")]));
 assert(pairs.ID==="fedora"&&pairs.VERSION_ID===String(version),"Guest Fedora version differs from pinned catalog");
 const rows=new TextDecoder("utf-8",{fatal:true}).decode(rpmRaw).trimEnd().split(/\r?\n/);
 assert(rows.length&&rows.every(x=>x.split("\t").length===3&&x.split("\t").every(Boolean))&&rows.every((x,i)=>i===0||rows[i-1]<=x),"Invalid guest package/license inventory");
 assert(rows.some(x=>x.startsWith("fedora-release")),"Missing Fedora distribution package");
}
export function verifyPointerReceipt(raw:Buffer,challenge:Buffer){
 const v=JSON.parse(raw.toString("utf8"));
 assert.deepEqual(Object.keys(v).sort(),["device","absoluteX","absoluteY","leftPress","leftRelease","challengeSha256"].sort(),"Unexpected tablet proof fields");
 assert(typeof v.device==="string"&&v.device.toLowerCase().includes("tablet"),"Wrong guest tablet device");
 assert([v.absoluteX,v.absoluteY].every(k=>Number.isInteger(k)&&k>=0&&k<=65535),"Invalid guest tablet coordinates");
 assert(v.leftPress===true&&v.leftRelease===true&&v.challengeSha256===sha(challenge),"Missing actual tablet click or challenge binding");return v;
}
