import {ApiError,owned,kube,vmiPath,kubeScreenshot,type Resource} from "./kube";

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
export function validateScreenshot(png:Buffer){
 if(png.length<45||!png.subarray(0,8).equals(signature)||png.readUInt32BE(8)!==13||png.toString("ascii",12,16)!=="IHDR")throw new ApiError(502,"Invalid upstream screenshot");
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 if(!width||!height||width>8192||height>8192||width*height>16777216||png.toString("ascii",png.length-8,png.length-4)!=="IEND")throw new ApiError(502,"Invalid screenshot dimensions or termination");
 return {width,height};
}
export function requireOwnedRunningInstance(vm:Resource,vmi:Resource,account:string){
 const phase=(vmi.status as {phase?:string}|undefined)?.phase;
 if(!vm.metadata?.uid||vm.metadata.deletionTimestamp||!vmi.metadata?.uid||vmi.metadata.deletionTimestamp||
    vmi.metadata.labels?.["vm-interface.io/account"]!==account||
    !vmi.metadata.ownerReferences?.some(o=>o.kind==="VirtualMachine"&&o.uid===vm.metadata?.uid)||
    phase!=="Running")throw new ApiError(409,"No owned running display instance");
 return vmi.metadata.uid;
}
export async function runningDisplay(id:string,account:string){
 const vm=await owned(id,account);
 let vmi:Resource;
 try{vmi=await kube("GET",vmiPath(id)) as Resource;}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(409,"No running display instance");throw e;}
 return requireOwnedRunningInstance(vm,vmi,account);
}
export async function screenshot(id:string,account:string,expectedInstance?:string){
 const before=await runningDisplay(id,account);
 if(expectedInstance!==undefined&&before!==expectedInstance)throw new ApiError(401,"Display ticket is no longer valid");
 const png=await kubeScreenshot(id);
 validateScreenshot(png);
 if(await runningDisplay(id,account)!==before)throw new ApiError(409,"Display instance changed during capture");
 return png;
}
