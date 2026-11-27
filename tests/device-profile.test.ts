import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {namespace,deployment,verifyDeployment,verifyPvc} from "../scripts/device_profile.ts";
test("only stage claim changes",()=>{const source=readFileSync(new URL("../infra/namespace.yaml",import.meta.url),"utf8");assert.equal(namespace(source,"core"),source);assert.equal(namespace(source,"android"),source.replace("requests: {storage: 512Mi}","requests: {storage: 20Gi}"));assert.throws(()=>namespace(source.replace("512Mi","1Gi"),"android"))});
test("both containers configured",()=>{for(const p of ["android","windows"]){const patch=deployment(p);verifyDeployment(patch,p);patch.spec.template.spec.containers.pop();assert.throws(()=>verifyDeployment(patch,p))}});
test("capacity",()=>{const claim={metadata:{name:"vm-media-stage"},spec:{resources:{requests:{storage:"20Gi"}}}};verifyPvc(claim,"android");assert.throws(()=>verifyPvc(claim,"core"))});
