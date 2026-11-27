import {createHash} from "node:crypto";
import assert from "node:assert/strict";
export const ANDROID_RESULT_MODE="dynamic:sha256-of-challenge-result-v3";
export function androidResult(challenge:Buffer){
 assert(Buffer.isBuffer(challenge)&&challenge.length===4096,"Expected exactly 4096 random challenge bytes");
 return Buffer.from("VM Interface Android APK functional proof\nchallenge-sha256:"+createHash("sha256").update(challenge).digest("hex")+"\n","ascii");
}
