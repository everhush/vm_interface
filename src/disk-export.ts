import {request} from "node:https";
import {Readable,Transform} from "node:stream";
import {ApiError,kube,owned,vmiPath,dvPath,pvcPath,type Resource} from "./kube";
import {readDataDisks,dataDiskClaim,dataDiskNamePattern} from "./data-disk-layout";
import {hasOwner,managedDisks} from "./storage";
import {mediaStatus} from "./media";
import {systemMaxGiB} from "./media-config";
import {growthState} from "./storage-growth-layout";
const ns=()=>process.env.VM_NAMESPACE||"vm-interface";
const exportPath=(id="")=>"/apis/export.kubevirt.io/v1/namespaces/"+ns()+"/virtualmachineexports"+(id?"/"+id:"");
const exportName=/^vx-[a-f0-9]{32}$/;
const tokenSecret="vm-api-export";
const computerLabel="vm-interface.io/computer", accountLabel="vm-interface.io/account", exportLabel="vm-interface.io/disk-export";
type ExportSpec={source?:{apiGroup?:string;kind?:string;name?:string};tokenSecretRef?:string;ttlDuration?:string};
type ExportStatus={phase?:string;ttlExpirationTime?:string;serviceName?:string;tokenSecretRef?:string;links?:{internal?:{cert?:string;volumes?:{name?:string;formats?:{format?:string;url?:string}[]}[]}}};
function exportToken(){const v=process.env.VM_EXPORT_TOKEN;if(!v||!/^[a-f0-9]{64}$/.test(v))throw new ApiError(409,"Native export is not configured");return v}
async function optional(path:string){try{return await kube("GET",path) as Resource}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export function assertCold(vm:Resource,vmi:Resource|null){
 const status=vm.status as {ready?:boolean;created?:boolean;stateChangeRequests?:unknown[]}|undefined;
 const spec=vm.spec as {runStrategy?:string}|undefined;
 if(!vm.metadata?.uid||vm.metadata.deletionTimestamp||vmi||spec?.runStrategy!=="Halted"||status?.ready||status?.created||status?.stateChangeRequests?.length)throw new ApiError(409,"Export requires a halted VM and converged lifecycle");
}
// Dots cannot occur in independent disk names, so reserved selectors cannot
// shadow an existing named data disk.
export function exportClaim(id:string,disk:string){
 if(!/^vm-[a-f0-9]{32}$/.test(id))throw new ApiError(422,"Invalid VM identifier");
 if(disk==="system.disk")return id+"-boot";
 if(disk==="exchange.disk")return id+"-exchange";
 if(!dataDiskNamePattern.test(disk))throw new ApiError(422,"Invalid disk identifier");
 return dataDiskClaim(id,disk);
}
export function exportSelector(id:string,claim:string){
 if(claim===id+"-boot")return "system.disk";
 if(claim===id+"-exchange")return "exchange.disk";
 const prefix=id+"-data-";
 if(!claim.startsWith(prefix)||!dataDiskNamePattern.test(claim.slice(prefix.length)))throw new ApiError(409,"Export source invalid");
 return claim.slice(prefix.length);
}
export function exportManifest(id:string,account:string,vmUid:string,disk:string,pvcUid:string,name:string){
 if(!exportName.test(name))throw new ApiError(422,"Invalid export identifier");
 const claim=exportClaim(id,disk);
 return {apiVersion:"export.kubevirt.io/v1",kind:"VirtualMachineExport",metadata:{name,labels:{[computerLabel]:id,[accountLabel]:account,[exportLabel]:"true"},annotations:{"vm-interface.io/pvc-uid":pvcUid},ownerReferences:[{apiVersion:"kubevirt.io/v1",kind:"VirtualMachine",name:id,uid:vmUid,controller:false,blockOwnerDeletion:false}]},spec:{source:{apiGroup:"",kind:"PersistentVolumeClaim",name:claim},tokenSecretRef:tokenSecret,ttlDuration:"15m0s"}};
}
export async function requireNoExports(id:string){
 const result=await kube("GET",exportPath()+"?labelSelector="+encodeURIComponent(computerLabel+"="+id+","+exportLabel+"=true")) as {items?:Resource[]};
 if(!Array.isArray(result.items))throw new ApiError(502,"Unable to verify native export state");
 if(result.items.length)throw new ApiError(409,"Close the offline export and wait for exporter deletion before modifying the VM");
}
async function diskTarget(id:string,account:string,disk:string,vm:Resource){
 const claim=exportClaim(id,disk),ref=managedDisks(vm,id).find(d=>d.name===claim);
 if(!ref)throw new ApiError(404,"Disk not found");
 if(ref.mode==="virtiofs")throw new ApiError(422,"VirtioFS is a shared filesystem, not a raw disk; use the published file exchange API");
 const d=ref.kind==="data"?readDataDisks(vm,id).find(v=>v.name===disk):undefined;
 const templates=(vm.spec as {dataVolumeTemplates?:{metadata?:{name?:string};spec?:{storage?:{resources?:{requests?:{storage?:string}}}}}[]})?.dataVolumeTemplates??[];
 const size=templates.find(t=>t.metadata?.name===claim)?.spec?.storage?.resources?.requests?.storage;
 const sizeGiB=d?.sizeGiB??(typeof size==="string"&&/^[1-9][0-9]*Gi$/.test(size)?Number(size.slice(0,-2)):0);
 if(!Number.isSafeInteger(sizeGiB)||sizeGiB<1||sizeGiB>systemMaxGiB)throw new ApiError(409,"Disk capacity not verified");
 const dv=await optional(dvPath(claim)),pvc=await optional(pvcPath(claim));
 const dvStorage=(dv?.spec as {storage?:{resources?:{requests?:{storage?:string}}}}|undefined)?.storage;
 if(!dv?.metadata?.uid||!pvc?.metadata?.uid||dv.metadata.name!==claim||pvc.metadata.name!==claim||dv.metadata.deletionTimestamp||pvc.metadata.deletionTimestamp||!hasOwner(dv,"VirtualMachine",vm.metadata?.uid)||!hasOwner(pvc,"DataVolume",dv.metadata.uid)||dv.metadata.labels?.[accountLabel]!==account||dv.metadata.labels?.[computerLabel]!==id||dvStorage?.resources?.requests?.storage!==sizeGiB+"Gi"||(dv.status as {phase?:string}|undefined)?.phase!=="Succeeded"||(pvc.status as {phase?:string}|undefined)?.phase!=="Bound")throw new ApiError(409,"Owned populated disk required for export");
 if(d?.media&&!(await mediaStatus(id,account,`data-${disk}`))?.ready)throw new ApiError(409,"Media transfer not verified");
 if(ref.kind==="boot"){const state=await mediaStatus(id,account,"boot");if(state&&!state.ready)throw new ApiError(409,"Boot media transfer not verified")}
 const growth=growthState(vm,claim,pvc);
 if(growth&&!growth.pvcCapacityConverged)throw new ApiError(409,"Wait for PVC growth convergence before exporting");
 return {claim,pvcUid:pvc.metadata.uid,sizeGiB:growth?.reservedGiB??sizeGiB};
}
async function ownedExport(id:string,account:string,name:string){
 const vm=await owned(id,account);
 if(!exportName.test(name))throw new ApiError(404,"Export not found");
 const exp=await kube("GET",exportPath(name)) as Resource,s=exp.spec as ExportSpec|undefined;
 if(!exp.metadata?.uid||exp.metadata.name!==name||!hasOwner(exp,"VirtualMachine",vm.metadata?.uid)||exp.metadata.labels?.[accountLabel]!==account||exp.metadata.labels?.[computerLabel]!==id||exp.metadata.labels?.[exportLabel]!=="true"||s?.tokenSecretRef!==tokenSecret||s.source?.kind!=="PersistentVolumeClaim"||(s.source.apiGroup??"")!==""||typeof s.source.name!=="string")throw new ApiError(404,"Export not found");
 const disk=exportSelector(id,s.source.name);
 return {vm,exp,disk};
}
export async function createDiskExport(id:string,account:string,disk:string,opId:string){
 exportToken();
 const vm=await owned(id,account);assertCold(vm,await optional(vmiPath(id)));
 await requireNoExports(id);
 const t=await diskTarget(id,account,disk,vm),name="vx-"+opId.replaceAll("-","");
 const manifest=exportManifest(id,account,vm.metadata!.uid!,disk,t.pvcUid,name);
 await kube("POST",exportPath()+"?dryRun=All",manifest);
 await kube("POST",exportPath(),manifest);
 return {id,exportId:name,disk,ttlSeconds:900,format:"raw",warning:"Offline raw disk only; wait for ready state before download"};
}
export function exportEndpoint(name:string,namespace:string,claim:string,status:ExportStatus){
 if(!exportName.test(name)||!/^[a-z0-9-]{1,63}$/.test(namespace)||!/^vm-[a-f0-9]{32}-(?:boot|exchange|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$/.test(claim))throw new ApiError(409,"Invalid export identity");
 const host="virt-export-"+name+"."+namespace+".svc",path="/volumes/"+claim+"/disk.img";
 const links=status.links?.internal,raw=links?.volumes?.find(v=>v.name===claim)?.formats?.find(f=>f.format==="raw");
 if(status.phase!=="Ready"||status.serviceName!=="virt-export-"+name||status.tokenSecretRef!==tokenSecret||raw?.url!=="https://"+host+path||!links?.cert||links.cert.length>32768||!links.cert.includes("-----BEGIN CERTIFICATE-----"))throw new ApiError(409,"Verified internal native raw export endpoint is not ready");
 const expiry=Date.parse(status.ttlExpirationTime??"");
 if(!Number.isFinite(expiry)||expiry<=Date.now())throw new ApiError(409,"Native export expired");
 return {host,path,ca:links.cert,expiry};
}
export async function diskExportStatus(id:string,account:string,name:string){
 const {vm,exp,disk}=await ownedExport(id,account,name);
 const t=await diskTarget(id,account,disk,vm);
 if(exp.metadata?.annotations?.["vm-interface.io/pvc-uid"]!==t.pvcUid)throw new ApiError(409,"Export source identity changed");
 const status=(exp.status??{}) as ExportStatus;
 let ready=false;try{exportEndpoint(name,ns(),t.claim,status);ready=!exp.metadata?.deletionTimestamp}catch(e){if(!(e instanceof ApiError))throw e}
 return {id,exportId:name,disk,phase:status.phase??"Pending",expiresAt:status.ttlExpirationTime??null,ready,format:"raw"};
}
export async function cancelDiskExport(id:string,account:string,name:string){
 const {exp}=await ownedExport(id,account,name);
 await kube("DELETE",exportPath(name),{propagationPolicy:"Foreground",preconditions:{uid:exp.metadata?.uid}});
 return {id,exportId:name,warning:"Wait for export deletion before starting or modifying the VM"};
}
export function exportResponseHeaders(claim:string,length:number){
 return {"content-type":"application/octet-stream","content-length":String(length),"x-vm-export-bytes":String(length),"content-disposition":"attachment; filename=\""+claim+".raw\"","cache-control":"no-store","x-content-type-options":"nosniff"};
}
export async function downloadDiskExport(id:string,account:string,name:string,signal:AbortSignal):Promise<Response>{
 const token=exportToken(),{vm,exp,disk}=await ownedExport(id,account,name);
 assertCold(vm,await optional(vmiPath(id)));
 if(exp.metadata?.deletionTimestamp)throw new ApiError(409,"Export is being deleted");
 const t=await diskTarget(id,account,disk,vm);
 if(exp.metadata?.annotations?.["vm-interface.io/pvc-uid"]!==t.pvcUid)throw new ApiError(409,"Export source identity changed");
 const endpoint=exportEndpoint(name,ns(),t.claim,(exp.status??{}) as ExportStatus);
 return new Promise((resolve,reject)=>{
  const req=request({hostname:endpoint.host,port:443,path:endpoint.path,method:"GET",ca:endpoint.ca,headers:{"x-kubevirt-export-token":token,"accept":"application/octet-stream"},signal,timeout:30000},res=>{
   const length=Number(res.headers["content-length"]),limit=t.sizeGiB*1024**3;
   if(res.statusCode!==200||!Number.isSafeInteger(length)||length<=0||length>limit){res.destroy();reject(new ApiError(502,"Native export response rejected"));return}
   let bytes=0;
   const bounded=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(bytes>length)callback(new Error("Export exceeds declared length"));else callback(null,chunk)},flush(callback){callback(bytes===length?undefined:new Error("Incomplete export"))}});
   res.on("error",e=>bounded.destroy(e));
   res.on("aborted",()=>bounded.destroy(new Error("Export stream aborted")));
   bounded.on("close",()=>res.destroy());
   res.pipe(bounded);
   resolve(new Response(Readable.toWeb(bounded) as ReadableStream<Uint8Array>,{headers:exportResponseHeaders(t.claim,length)}));
  });
  const timer=setTimeout(()=>req.destroy(new Error("Export deadline exceeded")),Math.max(1,Math.min(endpoint.expiry-Date.now(),600000)));
  req.on("close",()=>clearTimeout(timer));req.on("timeout",()=>req.destroy(new Error("Export timed out")));req.on("error",()=>reject(new ApiError(502,"Native export stream unavailable")));req.end();
 });
}
