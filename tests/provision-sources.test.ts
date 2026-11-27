import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {load,verify,COMMON,ARCH} from "../scripts/provision_sources.ts";
test("architectures and exact manifest",()=>{const m=JSON.parse(readFileSync(new URL("../infra/provision-sources.json",import.meta.url),"utf8"));for(const [a,b] of Object.entries(ARCH))assert.deepEqual(new Set(load(m,a).map(r=>r.name)),new Set([...COMMON,b]));m.assets[0].url="http://example.invalid/install.sh";assert.throws(()=>load(m,"aarch64"))});
test("reject tampered file",()=>{const root=mkdtempSync(join(tmpdir(),"vm-source-"));try{const p=join(root,"install.sh"),original=Buffer.from("trusted"),row={name:"install.sh",bytes:original.length,sha256:createHash("sha256").update(original).digest("hex")};writeFileSync(p,original);verify(p,row);writeFileSync(p,"changed");assert.throws(()=>verify(p,row));writeFileSync(p,"altered");assert.throws(()=>verify(p,row));}finally{rmSync(root,{recursive:true,force:true})}});
