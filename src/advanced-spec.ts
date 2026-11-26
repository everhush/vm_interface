import {z} from "zod";
import {computerSpec} from "./spec";

// Native field names, deliberately limited to the KubeVirt subset whose
// platform-owned construction and quota rules are understood. Never forward
// arbitrary caller-supplied VM templates, metadata, volumes or node placement.
const field=computerSpec.shape;
export const advancedComputerSpec=z.strictObject({
 version:field.version,name:field.name,image:field.image,storage:field.storage,
 media:field.media,auxiliaryDisk:field.auxiliaryDisk,bootBus:field.bootBus,pointerTablet:field.pointerTablet,
 cloudInit:field.cloudInit,idleStopSeconds:field.idleStopSeconds,
 kubevirt:z.strictObject({
  architecture:field.architecture,
  domain:z.strictObject({
   cpu:z.strictObject({cores:field.cpu}),
   resources:z.strictObject({requests:z.strictObject({memory:z.string().regex(/^[1-9][0-9]{2,3}Mi$/)})}),
   firmware:z.strictObject({bootloader:z.union([
    z.strictObject({bios:z.strictObject({})}),
    z.strictObject({efi:z.strictObject({secureBoot:z.literal(false)})})
   ])}).optional(),
   devices:z.strictObject({autoattachPodInterface:z.boolean(),interfaces:z.array(z.strictObject({
    name:z.literal("private"),masquerade:z.strictObject({}),model:z.literal("virtio")
   })).max(1)}).optional()
  }),
  networks:z.array(z.strictObject({name:z.literal("private"),pod:z.strictObject({})})).max(1).optional()
 })
}).superRefine((s,ctx)=>{
 const d=s.kubevirt.domain.devices,n=s.kubevirt.networks??[];
 const enabled=d?.autoattachPodInterface===true;
 if((d?.interfaces.length??0)!==(enabled?1:0)||n.length!==(enabled?1:0))
  ctx.addIssue({code:"custom",path:["kubevirt","networks"],message:"Native private network requires one matching masquerade interface and pod network; isolated profile requires neither"});
});
export const advancedSchema=z.toJSONSchema(advancedComputerSpec);

export function parseComputerRequest(input:unknown){
 if(!input||typeof input!=="object"||Array.isArray(input)||!("kubevirt" in input))return computerSpec.safeParse(input);
 const parsed=advancedComputerSpec.safeParse(input);
 if(!parsed.success)return parsed;
 const {kubevirt,...profile}=parsed.data;
 const d=kubevirt.domain;
 const firmware=d.firmware?("efi" in d.firmware.bootloader?"uefi":"bios"):undefined;
 // All existing cross-field, capacity and image constraints apply again.
 // Equivalent native and simplified requests share the same idempotency hash.
 return computerSpec.safeParse({...profile,architecture:kubevirt.architecture,
  cpu:d.cpu.cores,memoryMiB:Number(d.resources.requests.memory.slice(0,-2)),
  ...(firmware?{firmware}:{}),
  ...(d.devices?.autoattachPodInterface?{network:"private"}:d.devices?{network:"isolated"}:{})
 });
}
