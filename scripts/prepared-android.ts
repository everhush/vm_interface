/** Exact pinned media, signed APK and scenario preflight/launch. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,statSync} from "node:fs";
import {resolve,join} from "node:path";
import {parseArgs} from "node:util";
import {fileURLToPath} from "node:url";
import {fileSha256,isMain} from "./tooling.ts";
import {SOURCE,ARCHIVE_SHA} from "./prepare-android.ts";
import {loadScenario} from "./showcase-inputs.ts";
import {verifyProofApkMetadata} from "./apk-manifest-check.ts";
import {parseShowcase,preflight} from "./showcase-preflight.ts";
const ROOT=fileURLToPath(new URL("..",import.meta.url));
const json=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
type Pin={bytes:number;sha256:string;sizeGiB:number;virtualBytes:number};
export async function argumentsFor(root:string,transfer="virtiofs-saf"){
 assert(transfer==="virtiofs-saf"||transfer==="adb-saf","Invalid transfer");
 const m=json(join(root,"android-disk-manifest.json")),pinned=json(join(ROOT,"showcases/android/pinned-disks.json")) as Record<string,Pin>;
 assert(m.source===SOURCE&&m.archiveSha256===ARCHIVE_SHA&&m.architecture==="arm64"&&m.bootCertified===false,"Invalid pinned manifest");
 assert.deepEqual(m.disks,pinned,"Pinned disk metadata mismatch");
 for(const [name,pin] of Object.entries(pinned)){const path=join(root,"disks",name),s=statSync(path);assert(s.isFile()&&s.size===pin.bytes&&fileSha256(path)===pin.sha256,"Pinned disk bytes mismatch: "+name);}
 const apk=join(root,"proof.apk"),sha=fileSha256(apk);
 assert.deepEqual(readFileSync(join(root,"apk.sha256"),"utf8").trim().split(/\s+/),[sha,"proof.apk"],"APK checksum mismatch");
 const scenario=join(root,transfer==="adb-saf"?"android-adb-scenario.json":"android-scenario.json");loadScenario(scenario,"android");
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
 const jar=process.env.APKSIGNER_JAR||(sdk?join(sdk,"build-tools/34.0.0/lib/apksigner.jar"):undefined);
 const signer=jar&&existsSync(jar)?["java","-jar",jar]:["apksigner"];
 execFileSync(signer[0],[...signer.slice(1),"verify","--verbose",apk],{timeout:60000,stdio:["ignore","ignore","inherit"]});
 await verifyProofApkMetadata(apk);
 return ["--media",join(root,"disks/vda.qcow2"),"--media-sha256",pinned["vda.qcow2"].sha256,"--system-gib",String(pinned["vda.qcow2"].sizeGiB),"--auxiliary-media",join(root,"disks/vdb.qcow2"),"--auxiliary-sha256",pinned["vdb.qcow2"].sha256,"--auxiliary-gib",String(pinned["vdb.qcow2"].sizeGiB),"--source",SOURCE,"--version","v2026.10.18","--software",apk,"--software-sha256",sha,"--scenario",scenario,"--authorize-media","--record-consent"];
}
if(isMain(import.meta.url)){
 const {positionals,values:v}=parseArgs({allowPositionals:true,options:{"preflight-only":{type:"boolean"},"confirm-disposable":{type:"boolean"},transfer:{type:"string",default:"virtiofs-saf"},"authorize-android-debug":{type:"boolean"}}});
 assert(positionals.length===1&&Boolean(v["preflight-only"])!==Boolean(v["confirm-disposable"]),"Select exactly one mode");
 assert((v.transfer==="adb-saf")===Boolean(v["authorize-android-debug"]),"adb-saf requires explicit debug authorization");
 if(v["confirm-disposable"]&&v.transfer==="adb-saf")execFileSync("adb",["version"],{timeout:15000,stdio:"inherit"});
 const args=[...await argumentsFor(resolve(positionals[0]),v.transfer),"--android-transfer",v.transfer,...(v["authorize-android-debug"]?["--authorize-android-debug"]:[])];
 if(v["preflight-only"])console.log(JSON.stringify(preflight(parseShowcase(["android",...args,"--preflight-only"]))));
 else execFileSync("bash",[join(ROOT,"scripts/device-validate.sh"),"android","--confirm-disposable",...args],{stdio:"inherit"});
}
