import { z } from "zod";
import {mediaMaxBytes,systemMaxGiB,installerGiB} from "./media-config";
import {cirrosImage,fedoraImage} from "./catalog";
import {configuredStorageClass} from "./storage-class";
export {cirrosImage} from "./catalog";
export const storageSpec=z.strictObject({
 systemGiB:z.number().int().min(1).max(systemMaxGiB),
 exchangeGiB:z.number().int().min(1).max(4),
 exchangeMode:z.enum(["block","virtiofs"]).optional(),
 exchangeTag:z.enum(["exchange","share"]).optional()
});
export const mediaSpec=z.strictObject({
 format:z.enum(["qcow2","raw","iso"]),bytes:z.number().int().min(512).max(mediaMaxBytes),
 sha256:z.string().regex(/^[0-9a-f]{64}$/),source:z.string().min(1).max(256),
 os:z.string().min(1).max(64),version:z.string().min(1).max(64),
 authorizedByClient:z.literal(true)
});
export const computerSpec = z.strictObject({
  version:z.literal(1),
  name:z.string().min(1).max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/),
  architecture:z.enum(["amd64","arm64"]),
  cpu:z.number().int().min(1).max(4),
  memoryMiB:z.number().int().min(256).max(4096),
  image:z.enum(["cirros-smoke","fedora-exchange-test","uploaded-disk","uploaded-installer"]),
  media:mediaSpec.optional(),
  auxiliaryDisk:z.strictObject({sizeGiB:z.number().int().min(1).max(systemMaxGiB),media:mediaSpec}).optional(),
  firmware:z.enum(["bios","uefi"]).optional(),
  bootBus:z.enum(["virtio","sata"]).optional(),
  network:z.enum(["isolated","private"]).optional(),
  storage:storageSpec.optional(),
  cloudInit:z.string().min(1).max(8192).optional(),
  idleStopSeconds:z.number().int().min(60).max(86400).optional()
}).superRefine((s,ctx)=>{
 if(s.image==="fedora-exchange-test"&&(!s.storage||s.storage.systemGiB<4||s.memoryMiB<1536||s.storage.exchangeMode!=="virtiofs"))ctx.addIssue({code:"custom",path:["storage"],message:"Fedora test requires >=4GiB boot, >=1536MiB RAM and VirtioFS"});
 if(s.storage?.exchangeMode==="virtiofs"&&s.image==="cirros-smoke")ctx.addIssue({code:"custom",path:["storage","exchangeMode"],message:"CirrOS smoke profile has no certified VirtioFS driver"});
 if(s.cloudInit!==undefined&&s.image!=="fedora-exchange-test")ctx.addIssue({code:"custom",path:["cloudInit"],message:"Guest-native configuration only available for Fedora test"});
 if(s.storage?.exchangeTag!==undefined&&(s.storage.exchangeMode!=="virtiofs"||(s.storage.exchangeTag==="share"&&(s.architecture!=="arm64"||s.image!=="uploaded-disk"))))ctx.addIssue({code:"custom",path:["storage","exchangeTag"],message:"The share mount tag is restricted to uploaded ARM64 VirtioFS disks"});
 const upload=s.image==="uploaded-disk"||s.image==="uploaded-installer";
 if(upload&&(!s.storage||!s.media))ctx.addIssue({code:"custom",path:["media"],message:"Upload profiles need persistent storage and declared authorized media"});
 if(s.auxiliaryDisk){
  const a=s.auxiliaryDisk;
  const disk=s.image==="uploaded-disk"&&a.media.format!=="iso"&&s.bootBus!=="sata";
  const driver=s.image==="uploaded-installer"&&s.architecture==="amd64"&&a.media.format==="iso"&&Number.isSafeInteger(a.media.bytes)&&a.media.bytes>=512&&a.media.bytes<=mediaMaxBytes&&a.sizeGiB>=installerGiB(a.media.bytes);
  if(!disk&&!driver)ctx.addIssue({code:"custom",path:["auxiliaryDisk"],message:"Auxiliary media must be a virtio disk on an uploaded-disk profile or a capacity-checked read-only driver ISO on an amd64 installer profile"});
 }
 if(upload&&s.media&&((s.image==="uploaded-installer")!==(s.media.format==="iso")))ctx.addIssue({code:"custom",path:["media","format"],message:"Installer requires ISO; disk requires raw or qcow2"});
 if(s.architecture==="arm64"&&(!upload||s.image!=="uploaded-disk"||s.firmware!=="uefi"||s.bootBus==="sata"))ctx.addIssue({code:"custom",path:["architecture"],message:"ARM64 evaluation requires an authorized prepared UEFI virtio disk; no x86 or SATA fallback"});
 if(!upload&&(s.media||s.firmware||s.bootBus))ctx.addIssue({code:"custom",path:["media"],message:"Media and explicit firmware currently limited to upload profiles"});
});
export type ComputerSpec=z.infer<typeof computerSpec>;
export const schema=z.toJSONSchema(computerSpec);
export function diskNames(id:string){return {boot:id+"-boot",exchange:id+"-exchange"};}
function dataVolume(name:string,account:string,id:string,giB:number,source:object){
 return {metadata:{name,labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id}},spec:{
  source,storage:{storageClassName:configuredStorageClass(),accessModes:["ReadWriteOnce"],volumeMode:"Filesystem",resources:{requests:{storage:giB+"Gi"}}}
 }};
}
export function vmManifest(id:string,account:string,s:ComputerSpec){
 const names=diskNames(id);
 const persistent=s.storage, shared=persistent?.exchangeMode==="virtiofs";
 const exchangeTag=persistent?.exchangeTag??"exchange";
 const image=s.image==="fedora-exchange-test"?fedoraImage:cirrosImage;
 const uploadDisk=s.image==="uploaded-disk",installer=s.image==="uploaded-installer";
 const mediaName=id+"-installer";
 const uploadTemplate=(name:string,size:number)=>{const d=dataVolume(name,account,id,size,{upload:{}});return {...d,metadata:{...d.metadata,annotations:{"cdi.kubevirt.io/storage.bind.immediate.requested":"true"}}}};
 const templates=persistent?[
  uploadDisk?uploadTemplate(names.boot,persistent.systemGiB):dataVolume(names.boot,account,id,persistent.systemGiB,installer?{blank:{}}:{registry:{url:"docker://"+image}}),
  ...(!shared?[dataVolume(names.exchange,account,id,persistent.exchangeGiB,{blank:{}})]:[]),
  ...(installer?[uploadTemplate(mediaName,installerGiB(s.media!.bytes))]:[]),
  ...(s.auxiliaryDisk?[uploadTemplate(id+"-auxiliary",s.auxiliaryDisk.sizeGiB)]:[])
 ]:[];
 const volumes=persistent?[{name:"boot",dataVolume:{name:names.boot}},...(s.auxiliaryDisk?[{name:"auxiliary",dataVolume:{name:id+"-auxiliary"}}]:[]),shared?{name:exchangeTag,persistentVolumeClaim:{claimName:names.exchange}}:{name:"exchange",dataVolume:{name:names.exchange}}]:
  [{name:"boot",containerDisk:{image}}];
 const disks=persistent?[{name:"boot",disk:{bus:s.bootBus??"virtio"},bootOrder:installer?2:1},...(s.auxiliaryDisk?[s.auxiliaryDisk.media.format==="iso"?{name:"auxiliary",cdrom:{bus:"sata",readonly:true,tray:"closed"}}:{name:"auxiliary",disk:{bus:"virtio"},bootOrder:2}]:[]),...(!shared?[{name:"exchange",disk:{bus:s.bootBus??"virtio"}}]:[])]:[{name:"boot",disk:{bus:"virtio"}}];
 const mediaVolumes=installer?[{name:"installer",dataVolume:{name:mediaName}}]:[];
 const mediaDisks=installer?[{name:"installer",cdrom:{bus:"sata",readonly:true,tray:"closed"},bootOrder:1}]:[];
 const cloud=s.cloudInit?[{name:"cloudinit",cloudInitNoCloud:{userData:s.cloudInit}}]:[];
 const cloudDisks=s.cloudInit?[{name:"cloudinit",disk:{bus:"virtio"}}]:[];
 return {apiVersion:"kubevirt.io/v1",kind:"VirtualMachine",metadata:{name:id,labels:{"vm-interface.io/account":account},...(s.idleStopSeconds?{annotations:{"vm-interface.io/idle-stop-seconds":String(s.idleStopSeconds)}}:{})},spec:{
  runStrategy:"Halted",...(persistent?{dataVolumeTemplates:templates}:{}),template:{metadata:{labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id},...((shared||s.media)?{annotations:{...(shared?{"vm-interface.io/exchange-gib":String(persistent!.exchangeGiB),"vm-interface.io/exchange-tag":exchangeTag}:{}),...(s.media?{"vm-interface.io/media":JSON.stringify(s.media),"vm-interface.io/media-slot":installer?"installer":"boot"}:{}),...(s.auxiliaryDisk?{"vm-interface.io/auxiliary-media":JSON.stringify(s.auxiliaryDisk.media)}:{})}}:{})},spec:{
   architecture:s.architecture,nodeSelector:{"kubernetes.io/arch":s.architecture,"kubevirt.io/schedulable":"true"},
   domain:{cpu:{cores:s.cpu},resources:{requests:{memory:s.memoryMiB+"Mi"}},...(s.firmware==="uefi"?{firmware:{bootloader:{efi:{secureBoot:false}}}}:{}),devices:{disks:[...disks,...mediaDisks,...cloudDisks],autoattachPodInterface:s.network==="private",...(s.network==="private"?{interfaces:[{name:"private",masquerade:{},model:"virtio"}]}:{}),...(shared?{filesystems:[{name:exchangeTag,virtiofs:{}}],rng:{}}:{})}},
   networks:s.network==="private"?[{name:"private",pod:{}}]:[],volumes:[...volumes,...mediaVolumes,...cloud]
  }}
 }};
}
