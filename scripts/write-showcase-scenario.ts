/** Materialize bundled scenario inputs, without guest execution. */
import {writeFileSync} from "node:fs";
import assert from "node:assert/strict";
import {ANDROID_RESULT_MODE} from "./android-fixture.ts";
import {WINDOWS_RESULT,type Scenario,type Profile} from "./showcase-inputs.ts";
import {isMain} from "./tooling.ts";
export function generateScenario(profile:Profile,transfer="virtiofs-saf"):Scenario{
 assert(profile==="windows"||profile==="android","Invalid profile");
 assert(transfer==="virtiofs-saf"||(profile==="android"&&transfer==="adb-saf"),"Invalid Android transfer");
 if(profile==="windows")return {setup:[{human:"Complete authorized Windows Server 2022 Desktop Experience installation to the first reboot; do not enter credentials in this client."},{"system-boot":true},{human:"Complete authorized login and setup; open an elevated PowerShell prompt, then release the human control ticket."}],softwareSetup:[],application:[{wait:{text:"proof.7z",seconds:45}}],beforeMarker:"VMDRIVERSREADY",afterMarker:"proof.7z",resultName:"result.txt",expectedResultSha256:WINDOWS_RESULT};
 return {setup:[{human:transfer==="adb-saf"?"Complete first-run setup; enable ordinary authenticated ADB over Ethernet (TCP 5555). Never enable unauthenticated ADB or root.":"Complete authorized LineageOS 23.2 ARM64 first-run setup and verify that the exchange mount is accessible through the file picker."}],softwareSetup:[{human:transfer==="adb-saf"?"In the installed proof app select Documents/VMInterface using the ordinary SAF file picker, then release control.":"Install uploaded in-proof.apk, open VM Interface Proof, select the authorized exchange directory containing the challenge, then release control."}],application:[{"click-label":{text:"Compute proof",seconds:20}},{wait:{text:"APKCOMPLETE arm64-v8a",seconds:25}}],beforeMarker:"APKREADY arm64-v8a",afterMarker:"APKCOMPLETE arm64-v8a",resultName:"result.txt",expectedResultSha256:ANDROID_RESULT_MODE};
}
if(isMain(import.meta.url)){
 const [profile,output,...rest]=process.argv.slice(2);
 assert(output&&(rest.length===0||(rest.length===2&&rest[0]==="--android-transfer")),"Usage: profile output [--android-transfer transfer]");
 writeFileSync(output,JSON.stringify(generateScenario(profile as Profile,rest[1]),null,2)+"\n",{flag:"wx"});
}
