/** Read-only host preflight. KVM_CREATE_VM is not a guest or native proof. */
import { arch, tmpdir } from "node:os";
import { readFileSync, statfsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { isMain } from "./tooling.ts";
// Node has no ioctl binding. Compile a tiny, fixed Linux ABI probe instead of weakening the check to a device stat.
const probe= "#include <fcntl.h>\n#include <linux/kvm.h>\n#include <sys/ioctl.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(void){int fd=open(\"/dev/kvm\",O_RDWR|O_CLOEXEC);if(fd<0){perror(\"open /dev/kvm\");return 1;}puts(\"device\");int v=ioctl(fd,KVM_GET_API_VERSION,0);if(v<0){perror(\"KVM_GET_API_VERSION\");close(fd);return 2;}printf(\"version=%d\\n\",v);if(v!=12){close(fd);return 3;}int vm=ioctl(fd,KVM_CREATE_VM,0);if(vm<0){perror(\"KVM_CREATE_VM\");close(fd);return 4;}close(vm);close(fd);puts(\"created\");return 0;}\n";
export function inspect(expected:string,large=false){
 const architecture=({x64:"amd64",arm64:"arm64"} as Record<string,string>)[arch()]??arch();
 const memoryMiB=Math.floor(Number(/^MemTotal:\s+(\d+)/m.exec(readFileSync("/proc/meminfo","utf8"))?.[1]??0)/1024);
 const fs=statfsSync("/",{bigint:true}),freeGiB=Number(fs.bavail*fs.bsize/(1024n**3n));
 const errors:string[]=[];
 const result={scope:"host-preflight-only",architecture,expectedArchitecture:expected,memoryMiB,freeGiB,kvmDevice:false,kvmApiVersion:null as number|null,kvmCreateVm:false,nativeAccelerationCertified:false,errors,passed:false};
 if(architecture!==expected)errors.push("Architecture mismatch");
 if(memoryMiB<(large?12288:6144))errors.push("Insufficient RAM for selected disposable profile");
 if(freeGiB<(large?100:35))errors.push("Insufficient free root filesystem space for selected profile");
 const temp=mkdtempSync(join(tmpdir(),"vm-kvm-probe-"));
 try{
  const source=join(temp,"probe.c"), binary=join(temp,"probe");
  writeFileSync(source,probe,{mode:0o600});
  const compiled=spawnSync("cc",["-std=gnu11","-Wall","-Werror",source,"-o",binary],{encoding:"utf8",timeout:30000});
  if(compiled.status!==0)throw Error("KVM ioctl probe compilation failed: "+(compiled.error?.message??compiled.stderr));
  const ran=spawnSync(binary,[],{encoding:"utf8",timeout:10000});
  const lines=ran.stdout?.trim().split("\n")??[];
  result.kvmDevice=lines.includes("device");
  const version=lines.find(x=>x.startsWith("version="));if(version)result.kvmApiVersion=Number(version.slice(8));
  result.kvmCreateVm=lines.includes("created");
  if(ran.status!==0||result.kvmApiVersion!==12||!result.kvmCreateVm)throw Error("KVM ioctl probe failed: "+(ran.error?.message??ran.stderr??"Unexpected KVM API version"));
 }catch(e){errors.push(String(e));}finally{rmSync(temp,{recursive:true,force:true});}
 result.passed=errors.length===0;return result;
}
if(isMain(import.meta.url)){
 const {values}=parseArgs({options:{architecture:{type:"string"},"large-media":{type:"boolean"},output:{type:"string"}}});
 if(values.architecture!=="amd64"&&values.architecture!=="arm64")throw Error("--architecture must be amd64 or arm64");
 const result=inspect(values.architecture,values["large-media"]),encoded=JSON.stringify(result,null,2)+"\n";
 process.stdout.write(encoded);
 if(values.output){mkdirSync(dirname(values.output),{recursive:true});writeFileSync(values.output,encoded);}
 process.exitCode=result.passed?0:1;
}
