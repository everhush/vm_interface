/** Fail closed on repository-owned legacy tooling; external OCI registry names are not CLIs. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {isMain} from "./tooling.ts";
export function migrationViolations(path:string,content:string){
 const errors:string[]=[];
 if(/(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|\.dockerignore|docker-compose(?:\.[^/]*)?|compose\.ya?ml|__pycache__)(?:$|\/)|\.(?:py|pyc|pyo)$/i.test(path))errors.push("legacy tracked file");
 if(!/^(?:scripts\/|src\/|app\/|infra\/|showcases\/|\.github\/workflows\/|package\.json$)/.test(path)||!(/\.(?:ts|tsx|sh|ps1|json|ya?ml|m?js)$/.test(path)))return errors;
 if(path==="scripts/check-source-migration.ts")return errors;
 const checks:[RegExp,string][]=[
  [/\bpython(?:2|3(?:\.\d+)?)?\s+(?:-\w|[^\s"'\x60]+\.py\b)|\b(?:setup-python|python-version)\b|#![^\n]*\bpython[23]?\b/i,"interpreter invocation or CI dependency"],
  [/\b(?:sudo\s+)?docker\s+(?:buildx|build|run|compose|pull|push|load|save|exec|inspect|system|image|container|network|volume|login|version|info|ps|rm|rmi|tag|start|stop)\b|\bdocker-compose\b|\/var\/run\/docker\.sock|\bDOCKER_HOST\b|\b(?:docker\/setup-buildx-action|docker\/build-push-action|docker\/login-action)\b/i,"daemon-specific tooling"],
  [/\b(?:scripts|showcases)\/[^\s"'\x60]+\.py\b/i,"legacy script reference"]
 ];
 for(const [pattern,reason] of checks)if(pattern.test(content))errors.push(reason);
 return errors;
}
if(isMain(import.meta.url)){
 const paths=execFileSync("git",["ls-files","-z"]).toString("utf8").split("\0").filter(Boolean);
 const errors=paths.flatMap(path=>migrationViolations(path,readFileSync(path,"utf8")).map(reason=>path+": "+reason));
 assert.equal(errors.length,0,errors.join("\n"));console.log("Verified tracked source migration: "+paths.length+" files, no legacy interpreter or daemon-specific tooling.");
}
