import { z } from "zod";
import {cirrosImage,fedoraImage} from "./catalog";
export {cirrosImage} from "./catalog";
export const storageSpec=z.strictObject({
 systemGiB:z.number().int().min(1).max(8),
 exchangeGiB:z.number().int().min(1).max(4),
 exchangeMode:z.enum(["block","virtiofs"]).optional()
});
export const computerSpec = z.strictObject({
  version:z.literal(1),
  name:z.string().min(1).max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/),
  architecture:z.enum(["amd64","arm64"]),
  cpu:z.number().int().min(1).max(4),
  memoryMiB:z.number().int().min(256).max(4096),
  image:z.enum(["cirros-smoke","fedora-exchange-test"]),
  storage:storageSpec.optional(),
  cloudInit:z.string().min(1).max(8192).optional()
}).superRefine((s,ctx)=>{
 if(s.image==="fedora-exchange-test"&&(!s.storage||s.storage.systemGiB<4||s.memoryMiB<1536||s.storage.exchangeMode!=="virtiofs"))ctx.addIssue({code:"custom",path:["storage"],message:"Fedora test requires >=4GiB boot, >=1536MiB RAM and VirtioFS"});
 if(s.storage?.exchangeMode==="virtiofs"&&s.image!=="fedora-exchange-test")ctx.addIssue({code:"custom",path:["storage","exchangeMode"],message:"VirtioFS currently limited to Fedora test guest"});
 if(s.cloudInit!==undefined&&s.image!=="fedora-exchange-test")ctx.addIssue({code:"custom",path:["cloudInit"],message:"Guest-native configuration only available for Fedora test"});
});
export type ComputerSpec=z.infer<typeof computerSpec>;
export const schema=z.toJSONSchema(computerSpec);
export function diskNames(id:string){return {boot:id+"-boot",exchange:id+"-exchange"};}
function dataVolume(name:string,account:string,id:string,giB:number,source:object){
 return {metadata:{name,labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id}},spec:{
  source,storage:{storageClassName:"local-path",accessModes:["ReadWriteOnce"],volumeMode:"Filesystem",resources:{requests:{storage:giB+"Gi"}}}
 }};
}
export function vmManifest(id:string,account:string,s:ComputerSpec){
 const names=diskNames(id);
 const persistent=s.storage, shared=persistent?.exchangeMode==="virtiofs";
 const image=s.image==="fedora-exchange-test"?fedoraImage:cirrosImage;
 const templates=persistent?[
  dataVolume(names.boot,account,id,persistent.systemGiB,{registry:{url:"docker://"+image}}),
  ...(!shared?[dataVolume(names.exchange,account,id,persistent.exchangeGiB,{blank:{}})]:[])
 ]:[];
 const volumes=persistent?[{name:"boot",dataVolume:{name:names.boot}},shared?{name:"exchange",persistentVolumeClaim:{claimName:names.exchange}}:{name:"exchange",dataVolume:{name:names.exchange}}]:
  [{name:"boot",containerDisk:{image}}];
 const disks=persistent?[{name:"boot",disk:{bus:"virtio"},bootOrder:1},...(!shared?[{name:"exchange",disk:{bus:"virtio"}}]:[])]:[{name:"boot",disk:{bus:"virtio"}}];
 const cloud=s.cloudInit?[{name:"cloudinit",cloudInitNoCloud:{userData:s.cloudInit}}]:[];
 const cloudDisks=s.cloudInit?[{name:"cloudinit",disk:{bus:"virtio"}}]:[];
 return {apiVersion:"kubevirt.io/v1",kind:"VirtualMachine",metadata:{name:id,labels:{"vm-interface.io/account":account}},spec:{
  runStrategy:"Halted",...(persistent?{dataVolumeTemplates:templates}:{}),template:{metadata:{labels:{"vm-interface.io/account":account,"vm-interface.io/computer":id},...(shared?{annotations:{"vm-interface.io/exchange-gib":String(persistent!.exchangeGiB)}}:{})},spec:{
   architecture:s.architecture,nodeSelector:{"kubernetes.io/arch":s.architecture,"kubevirt.io/schedulable":"true"},
   domain:{cpu:{cores:s.cpu},resources:{requests:{memory:s.memoryMiB+"Mi"}},devices:{disks:[...disks,...cloudDisks],autoattachPodInterface:false,...(shared?{filesystems:[{name:"exchange",virtiofs:{}}],rng:{}}:{})}},
   networks:[],volumes:[...volumes,...cloud]
  }}
 }};
}
