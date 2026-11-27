/** Verify actual retained native guest evidence; never generate substitute recordings. */
import assert from "node:assert/strict";
import {existsSync,readFileSync,statSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {parseArgs} from "node:util";
import {fileSha256,isMain} from "./tooling.ts";
import {verifyMarkerFrames,ocr} from "./evidence-frames.ts";
import {ANDROID_RESULT_MODE,androidResult} from "./android-fixture.ts";
import {loadScenario} from "./showcase-inputs.ts";
import {verifyStagedBundle} from "./android-guest-transfer.ts";
import {packageBytes,verifyArchive,verifyPlatform,verifyPointerReceipt} from "./linux-showcase-fixture.ts";
import {sha} from "./api-client.ts";
export function sourceIdentity(proof:Record<string,unknown>,expected?:string){
 const {commit,runId}=proof;assert(typeof commit==="string"&&/^[a-f0-9]{40}$/.test(commit),"Missing exact source commit");assert(typeof runId==="string"&&/^(?:[0-9]+|device-[0-9]{8}T[0-9]{6}Z-[0-9]+)$/.test(runId),"Missing exact hosted or disposable-device run identity");if(expected!==undefined)assert.equal(commit,expected,"Evidence source commit differs from approved candidate");return [commit,runId] as const;
}
type Profile="control"|"functional"|"windows"|"android";
async function verifyFolder(folder:string,profile:Profile,expectedCommit?:string){
 const file=(n:string)=>join(folder,n),read=(n:string)=>readFileSync(file(n)),json=(n:string)=>JSON.parse(read(n).toString("utf8"));
 const proof=json("verification.json"),[commit,runId]=sourceIdentity(proof,expectedCommit),meta=proof.recording,raw=file("platform-recording.mp4"),s=statSync(raw);
 assert(s.isFile()&&s.size>0&&fileSha256(raw)===meta.sha256,"Recording SHA256 mismatch");if("bytes" in meta)assert.equal(s.size,meta.bytes,"Recording length mismatch");
 const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",raw],{timeout:30000,encoding:"utf8"}));assert(probe.streams.length===1&&probe.streams[0].codec_name==="h264"&&Number(probe.format.duration)>0,"Unexpected recording format");execFileSync("ffmpeg",["-v","error","-xerror","-i",raw,"-f","null","-"],{timeout:120000,stdio:"ignore"});assert(meta.fullDecode===true,"Original verification did not report full decode");assert(existsSync(file("video-first-marker.png"))&&existsSync(file("video-final-marker.png")),"Missing decoded marker frames");
 const video={sha256:fileSha256(raw),durationSeconds:Number(probe.format.duration),bytes:s.size,...verifyMarkerFrames(raw,folder,meta,profile)};
 const trace=file("http-trace.jsonl"),rows=readFileSync(trace,"utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x) as Record<string,unknown>);
 assert(rows.length&&rows.every(r=>r.status===r.expected&&Object.keys(r).every(k=>["elapsedMs","method","path","status","expected","responseMs","phase"].includes(k))),"Missing, failed or unexpected HTTP trace");
 const phases=new Set(rows.map(r=>r.phase));const requirePhases=(...names:string[])=>assert(names.every(n=>phases.has(n)),"Missing required phases: "+names.filter(n=>!phases.has(n)).join(","));
 const flags=(...names:string[])=>assert(names.every(k=>proof[k]===true),"Missing proof assertions: "+names.filter(k=>proof[k]!==true).join(","));
 const hash=(name:string,expected:string)=>assert.equal(fileSha256(file(name)),expected,name+" hash mismatch");
 requirePhases("create","start","record start","record stop","retrieve MP4","stop");
 if(profile==="control"){
  flags("actualGuestBootScreen","automationLease","idempotentReplay","crossAccountDenied","keyRevoked","stoppedAndDeleted");hash("http-trace.jsonl",proof.trace.sha256);requirePhases("first input","second input","idempotent replay");
 }else if(profile==="functional"){
  flags("guestComputedResult","actualGuestVisibleResult","stoppedOutputPersistent","softwareInstalled","coldResizeAndFilePersistence","guestPointerProof","guestDiskCloneByteProof");
  hash("http-trace.jsonl",proof.traceSha256);hash("guest-result.bin",proof.outputSha256);requirePhases("upload file","download file","guest action","upload software","download archive","cold resize","restart after resize");
  assert(proof.profile==="linux"&&proof.architecture==="amd64","Missing Linux installation and persistence evidence");
  assert(read("software.zip").equals(packageBytes()),"Software package mismatch");hash("software.zip",proof.softwareSha256);
  const challenge=read("challenge.bin");assert(challenge.length===proof.inputBytes&&challenge.length===4096);hash("challenge.bin",proof.inputSha256);assert(read("guest-result.bin").equals(Buffer.from("guest-result:"+sha(challenge)+"\n")),"Wrong guest result");
  hash("pointer-receipt.json",proof.pointerReceiptSha256);verifyPointerReceipt(read("pointer-receipt.json"),challenge);
  hash("pointer-ready.png",proof.pointerReadyScreenshotSha256);assert(ocr(file("pointer-ready.png")).includes("pointerready"),"Missing visible pointer readiness");
  hash("after.png",proof.pointerDoneScreenshotSha256);assert(ocr(file("after.png")).includes("pointerdone"),"Missing visible pointer completion");requirePhases("observer pointer denied","outside pointer denied","guest pointer action","pointer replay");
  await verifyArchive(read("guest-archive.zip"),challenge);hash("guest-archive.zip",proof.archiveSha256);assert(!Object.values(proof.originalPvcUids).includes(proof.clonePvcUid),"Missing distinct disk clone evidence");
  assert(read("disk-original.bin").equals(challenge)&&read("disk-original-after.bin").equals(challenge)&&read("disk-clone-after.bin").equals(Buffer.from(challenge.map(x=>x^255))),"Guest disk clone byte proof mismatch");
  hash("guest-platform.json",proof.guestPlatformSha256);hash("guest-rpm.tsv",proof.guestRpmSha256);verifyPlatform(read("guest-platform.json"),read("guest-rpm.tsv"),proof.image.version);
  assert(proof.instanceUid!==proof.resizedInstanceUid,"Missing reboot identity evidence");hash("reboot.png",proof.rebootScreenshotSha256);assert.equal(ocr(file("reboot.png")).split("proofpersisted").length,2,"Installed application persistence marker absent");assert(rows.some(r=>r.phase==="cold resize"&&r.status===202),"Successful resize response missing");
 }else{
  assert(proof.profile===profile&&proof.architecture===(profile==="windows"?"amd64":"arm64"),"Wrong showcase profile");flags("screenMarkersVerified","coldResizeAndFilePersistence");
  let expected:Buffer;if(profile==="windows")expected=Buffer.from("VM Interface Windows 7-Zip functional proof\n");else{
   const challenge=read("challenge.bin");assert(proof.resultMode===ANDROID_RESULT_MODE&&proof.challengeBytes===challenge.length,"Missing exact Android challenge proof");hash("challenge.bin",proof.challengeSha256);hash("proof.apk",proof.softwareSha256);hash("scenario.json",proof.scenarioSha256);loadScenario(file("scenario.json"),"android");requirePhases("upload challenge");expected=androidResult(challenge);
   assert(proof.instanceUid!==proof.resizedInstanceUid&&proof.cpuAfterResize===3&&Object.keys(proof.originalPvcUids).length>=2,"Missing native resize or persistent PVC identity proof");assert.deepEqual(proof.originalPvcUids,proof.resizedPvcUids);requirePhases("restart after resize");
   const transfer=proof.transferPath;assert(["virtiofs-saf","authorized-adb-over-private-tunnel"].includes(transfer),"Unknown Android transfer path");
   if(transfer==="authorized-adb-over-private-tunnel"){
    const report=json("android-adb.json");hash("android-adb.json",proof.guestTransferSha256);assert(report.transferPath===transfer&&report.freshKeyAuthorized===true&&report.adbSecure===true&&report.selinux==="Enforcing"&&report.shellUid===2000&&report.abi==="arm64-v8a","Missing authenticated non-root guest security evidence");
    assert(report.installedApkSha256===proof.softwareSha256&&report.guestChallengeSha256===proof.challengeSha256&&report.guestOutputSha256===report.rebootOutputSha256&&report.guestOutputSha256===proof.outputSha256,"Guest transfer byte mismatch");
    hash("staged-exchange.tar",report.stagedBundleSha256);verifyStagedBundle(read("staged-exchange.tar"),{"proof.apk":read("proof.apk"),"challenge.bin":challenge});requirePhases("staged bundle","guest transfer grant","guest transfer revoke","guest transfer ownership denial");
   }else requirePhases("download file");
  }
  assert(read("guest-result.bin").equals(expected),"Unexpected native result bytes");hash("guest-result.bin",proof.outputSha256);hash("http-trace.jsonl",proof.traceSha256);requirePhases("upload file","guest action");if(profile==="windows"||proof.transferPath==="virtiofs-saf")requirePhases("download file");
 }
 return {profile,commit,runId,video,httpCalls:rows.length,scope:"artifact-integrity-independent-marker-decode-and-reported-assertions"};
}
if(isMain(import.meta.url)){
 const {values}=parseArgs({options:{root:{type:"string"},profile:{type:"string"},commit:{type:"string"}}});assert(values.root&&values.profile&&["core","linux","windows","android","all"].includes(values.profile));
 const folders={control:"api-control-proof",functional:"api-functional-proof",windows:"showcase-windows",android:"showcase-android"},targets=(values.profile==="core"?["control","functional"]:values.profile==="linux"?["functional"]:values.profile==="all"?["control","functional","android"]:[values.profile]) as Profile[];
 const passed:Awaited<ReturnType<typeof verifyFolder>>[]=[],failed:{profile:string;error:string}[]=[];
 for(const profile of targets)try{passed.push(await verifyFolder(join(values.root,folders[profile]),profile,values.commit));}catch(e){failed.push({profile,error:e instanceof Error?e.message:String(e)});}
 if(passed.length>1){if(new Set(passed.map(x=>x.commit)).size!==1)failed.push({profile:values.profile,error:"Mixed source commits are not a comprehensive pass"});if(values.profile==="core"&&new Set(passed.map(x=>x.runId)).size!==1)failed.push({profile:values.profile,error:"Core evidence must come from the same execution"});}
 console.log(JSON.stringify({passed,failed,hardwareCertifiedByVerifier:false},null,2));process.exitCode=failed.length?1:0;
}
