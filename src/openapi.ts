import { schema } from "./spec";
import {advancedSchema} from "./advanced-spec";
import {z} from "zod";
import {keySpec} from "./account-keys";
import {recordingSpec} from "./recordings";
import {batchSpec} from "./input-batch";
import {exposureSpec} from "./network";
import {bootSpec} from "./boot";
import {hardwareSchema} from "./hardware";
import {dataDiskSpec} from "./data-disks";
import {growthSpec} from "./storage-growth";
import {artifactSpec,artifactReference} from "./media-artifacts";

const object = {type:"object"} as const;
const ref = (name:string) => ({"$ref":"#/components/schemas/"+name});
const json = (schema:unknown) => ({"application/json":{schema}});
const response = (description:string,schema:unknown=object) => ({description,content:json(schema)});
const errors = {
 "400":response("Invalid request or missing idempotency key",ref("Error")),
 "401":response("Invalid or missing bearer token",ref("Error")),
 "403":response("Credential lacks permission",ref("Error")),
 "404":response("Resource absent or not owned by account",ref("Error")),
 "409":response("Conflict or idempotency mismatch",ref("Error")),
 "413":response("Request exceeds size limit",ref("Error")),
 "422":response("Invalid or unsupported configuration",ref("Error")),
 "429":response("Authenticated account request rate exceeded",ref("Error")),
 "500":response("Internal service error",ref("Error")),
 "502":response("Upstream Kubernetes error",ref("Error"))
};
const id = {name:"id",in:"path",required:true,schema:{type:"string",pattern:"^vm-[a-f0-9]{32}$"}};
const opId = {name:"id",in:"path",required:true,schema:{type:"string",format:"uuid"}};
const idem = {name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:128,pattern:"^[A-Za-z0-9_.:-]+$"}};
const deleteDisks={name:"deleteDisks",in:"query",required:false,schema:{type:"boolean"},description:"Must explicitly be true when deleting a VM with persistent disks; all its managed disks are affected"};
const bootBody={required:true,content:json(ref("BootSpec"))};
const hardwareBody={required:true,content:json(ref("HardwareSpec"))};
const diskBody={required:true,content:json(ref("DataDiskSpec"))};
const body = {required:true,content:json({oneOf:[ref("ComputerSpec"),ref("AdvancedComputerSpec")]})};
const read = (summary:string,schema:unknown=object,parameters:unknown[]=[])=>({summary,parameters,responses:{"200":response("Success",schema),...errors}});
const write = (summary:string,parameters:unknown[],requestBody?:unknown)=>({summary,parameters,...(requestBody?{requestBody}:{}),responses:{"202":response("Mutation recorded; submission is not completion. Replaying rejected submissions returns the recorded HTTP rejection.",ref("Submission")),...errors}});
const lifecycle = (name:string)=>({post:write(name+" computer; poll computer state to verify convergence",[id,idem])});
export function openApiDocument(){
 const computer = {...schema}; delete computer.$schema;
 const advanced={...advancedSchema};delete advanced.$schema;
 const boot=z.toJSONSchema(bootSpec);delete boot.$schema;
 const hardware={...hardwareSchema};delete hardware.$schema;
 const disk=z.toJSONSchema(dataDiskSpec);delete disk.$schema;
 const keySchema=z.toJSONSchema(keySpec);delete keySchema.$schema;
 const recordingSchema=z.toJSONSchema(recordingSpec);delete recordingSchema.$schema;
 const exposureSchema=z.toJSONSchema(exposureSpec);delete exposureSchema.$schema;
 const batchSchema=z.toJSONSchema(batchSpec);delete batchSchema.$schema;
 const recordingId={name:"recordingId",in:"path",required:true,schema:{type:"string",format:"uuid"}};
 const keyId={name:"keyId",in:"path",required:true,schema:{type:"string",format:"uuid"}};
 return {
  openapi:"3.1.0",
  info:{title:"VM Interface API",version:"0.1.0",description:"Test-only virtualization backend. Implemented operations are not certified until real CI evidence exists. Persistent CDI test storage is experimental; guest data persistence and console capabilities are not certified."},
  servers:[{url:"/api/v1"}],
  security:[{TestBearer:[]}],
  paths:{
   "/health":{get:{...read("Check database and Kubernetes API readiness"),security:[]}},
   "/account":{get:read("Current test account")},
   "/keys":{get:read("List account key metadata; test account identity only",{type:"array",items:ref("AccountKey")}),post:{summary:"Create account key; secret shown once; test account identity only",requestBody:{required:true,content:json(ref("AccountKeySpec"))},responses:{"201":response("Created key",ref("AccountKeySecret")),...errors}}},
   "/keys/{keyId}":{delete:read("Revoke account key; test account identity only",ref("AccountKey"),[keyId])},
   "/keys/{keyId}/rotate":{post:{summary:"Atomically rotate active key, preserving expiry; test account identity only",parameters:[keyId],responses:{"201":response("Rotated key",ref("AccountKeySecret")),...errors}}},
   "/audit":{get:read("Latest 100 redacted account API events; seven-day retention",{type:"array",items:object})},
   "/account/quota":{get:read("Owned computer desired-resource quota and current reservations",ref("Quota"))},
   "/schema":{get:read("ComputerSpec JSON Schema")},
   "/schema/advanced":{get:read("Versioned allowlisted native KubeVirt field subset")},
   "/images":{get:read("Allowlisted image catalog with immutable OCI references and qualification status",{type:"array",items:ref("CatalogImage")})},
   "/media-artifacts":{get:read("List only account-owned registered media declarations and storage quota"),post:write("Reserve immutable account-owned artifact declaration; upload verified bytes separately",[idem],{required:true,content:json(z.toJSONSchema(artifactSpec))})},
   "/media-artifacts/{artifactId}":{get:read("Inspect owned registered image",object,[{name:"artifactId",in:"path",required:true,schema:{type:"string",format:"uuid"}}]),delete:write("Delete owned registered image; existing independent VM disks are unchanged",[idem,{name:"artifactId",in:"path",required:true,schema:{type:"string",format:"uuid"}}])},
   "/media-artifacts/{artifactId}/file":{put:write("Upload exact declared image bytes once; verify digest and format before publication",[idem,{name:"artifactId",in:"path",required:true,schema:{type:"string",format:"uuid"}}],{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",maxLength:67108864}}}})},
   "/computers/{id}/media/{slot}/artifact":{post:write("Import verified owned registered media into independently reserved CDI disk; exact declaration and architecture must match",[id,idem,{name:"slot",in:"path",required:true,schema:{type:"string"}}],{required:true,content:json(z.toJSONSchema(artifactReference))})},
   "/capabilities":{get:read("Implemented, conditional and unsupported capabilities")},
   "/openapi.json":{get:read("OpenAPI document")},
   "/computers/plan":{post:{...read("Validate and server-side dry-run the configuration"),requestBody:body}},
   "/computers":{get:read("List owned computers",{type:"array",items:ref("ComputerSummary")}),post:write("Create a halted computer",[idem],body)},
   "/computers/{id}":{get:read("Inspect desired and current VM/VMI state",ref("ComputerDetail"),[id]),delete:write("Delete owned computer; explicit confirmation for persistent disks",[id,idem,deleteDisks])},
   "/computers/{id}/boot":{patch:write("Change stopped installer VM boot priority and optional CD-ROM tray; preserve all disks",[id,idem],bootBody)},
   "/computers/{id}/boot/plan":{post:{...read("Server-side dry-run of boot priority change",object,[id]),requestBody:bootBody}},
   "/computers/{id}/hardware":{patch:write("Change CPU and RAM on a fully stopped computer; optimistic resource version required",[id,idem],hardwareBody)},
   "/computers/{id}/hardware/plan":{post:{...read("Server-side dry-run of cold CPU/RAM change",object,[id]),requestBody:hardwareBody}},
   "/computers/{id}/exposures":{get:read("List private guest TCP grants",{type:"array",items:object},[id]),post:{summary:"Issue expiring instance-bound private TCP tunnel grant",parameters:[id],requestBody:{required:true,content:json(ref("ExposureSpec"))},responses:{"201":response("Grant and secret shown once"),...errors}}},
   "/computers/{id}/exposures/{grantId}":{delete:read("Revoke owned tunnel grant",object,[id,{name:"grantId",in:"path",required:true,schema:{type:"string",format:"uuid"}}])},
   "/computers/{id}/exposures/{grantId}/connect":{get:{summary:"Authenticated binary WSS tunnel to declared guest TCP port",parameters:[id,{name:"grantId",in:"path",required:true,schema:{type:"string",format:"uuid"}}],security:[{NetworkGrant:[]}],servers:[{url:"https://{gatewayHost}:3443/api/v1",variables:{gatewayHost:{default:"localhost"}}}],"x-websocket":true,responses:{"101":{description:"Private TCP tunnel"},...errors}}},
   "/computers/{id}/media":{get:read("Inspect declared media and CDI import verification",object,[id])},
   "/computers/{id}/media/{slot}/chunks":{put:write("Upload one aligned verified chunk; GET media exposes committed offset",[id,idem,{name:"slot",in:"path",required:true,schema:{type:"string",pattern:"^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$"}},{name:"Upload-Offset",in:"header",required:true,schema:{type:"integer",minimum:0}},{name:"X-Content-SHA256",in:"header",required:true,schema:{type:"string",pattern:"^[a-f0-9]{64}$"}}],{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",maxLength:8388608}}}}),delete:write("Discard staged uncommitted media only; does not delete imported disk",[id,idem,{name:"slot",in:"path",required:true,schema:{type:"string",pattern:"^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$"}}])},
   "/computers/{id}/media/{slot}/commit":{post:write("Verify entire staged media digest and submit to CDI",[id,idem,{name:"slot",in:"path",required:true,schema:{type:"string",pattern:"^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$"}}])},
   "/computers/{id}/media/{slot}":{get:read("Inspect one declared media slot",object,[id,{name:"slot",in:"path",required:true,schema:{type:"string",pattern:"^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$"}}]),put:write("Upload declared authorized media bytes to CDI; verify digest before transmission",[id,idem,{name:"slot",in:"path",required:true,schema:{type:"string",pattern:"^(boot|installer|auxiliary|data-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?)$"}}],{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",maxLength:67108864}}}})},
   "/computers/{id}/exchange-bundle":{get:{summary:"Download a bounded TAR of published VirtioFS inputs and verified outputs on a halted VM (not a full filesystem snapshot)",parameters:[id],responses:{"200":{description:"Published file bundle with manifest and SHA256 header",content:{"application/x-tar":{schema:{type:"string",format:"binary"}}}},...errors}}},
   "/computers/{id}/files":{get:read("List fully published guest output files",{type:"array",items:ref("ExchangeFile")},[id])},
   "/computers/{id}/files/{name}":{get:{summary:"Download verified guest output bytes",parameters:[id,{name:"name",in:"path",required:true,schema:{type:"string"}}],responses:{"200":{description:"Verified output",content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},...errors}},put:write("Upload actual bytes atomically into the exchange volume",[id,idem,{name:"name",in:"path",required:true,schema:{type:"string"}},{name:"X-Content-SHA256",in:"header",required:true,schema:{type:"string",pattern:"^[0-9a-f]{64}$"}}],{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",maxLength:8388608}}}})},
   "/computers/{id}/storage":{get:read("Inspect account-owned managed DataVolumes and PVCs including retained detached data disks",object,[id]),patch:write("Submit monotonic PVC growth on an operator-qualified CSI profile; guest growth is separate",[id,idem],{required:true,content:json(z.toJSONSchema(growthSpec))})},
   "/computers/{id}/storage/plan":{post:{...read("Dry-run PVC growth and quota",object,[id]),requestBody:{required:true,content:json(z.toJSONSchema(growthSpec))}}},
   "/computers/{id}/disks":{post:write("Create, import or clone a reserved same-VM data disk, attach or detach while stopped; detached disks retain data and quota",[id,idem],diskBody)},
   "/computers/{id}/disk-exports/{name}":{post:write("Create bounded native offline export for an owned populated raw disk (data disk name, system.disk, or exchange.disk for block exchange)",[id,idem,{name:"name",in:"path",required:true,schema:{type:"string"}}]),get:read("Inspect private native export readiness",object,[id,{name:"name",in:"path",required:true,schema:{type:"string"}}]),delete:write("Close native export and release source after foreground deletion",[id,idem,{name:"name",in:"path",required:true,schema:{type:"string"}}])},
   "/computers/{id}/disk-exports/{name}/file":{get:{summary:"Stream owned native raw disk bytes",parameters:[id,{name:"name",in:"path",required:true,schema:{type:"string"}}],responses:{"200":{description:"Raw disk image",headers:{"X-VM-Export-Bytes":{description:"Exact validated native byte count independent of HTTP framing; reject incomplete streams",schema:{type:"string",pattern:"^[1-9][0-9]*$"}}},content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},...errors}}},
   "/computers/{id}/disks/plan":{post:{...read("Dry-run cold data disk operation and quota",object,[id]),requestBody:diskBody}},
   "/computers/{id}/console-tickets":{get:read("List active-window owned display ticket metadata",{type:"array",items:ref("DisplayTicket")},[id]),post:{summary:"Issue one short-lived screenshot-only, observer or control VNC ticket; secret returned once",parameters:[id],requestBody:{required:false,content:json({type:"object",additionalProperties:false,required:["scope"],properties:{scope:{enum:["screenshot-only","observe-vnc","control-vnc"]}}})},responses:{"201":response("New display ticket",ref("DisplayTicketSecret")),...errors}}},
   "/computers/{id}/console-tickets/{ticketId}":{delete:read("Revoke an owned display ticket",[ref("DisplayTicket")][0],[id,{name:"ticketId",in:"path",required:true,schema:{type:"string",format:"uuid"}}])},
   "/computers/{id}/recordings":{get:read("List account-owned recording metadata",{type:"array",items:ref("Recording")},[id]),post:write("Queue opt-in display recording",[id,idem],{required:true,content:json(ref("RecordingSpec"))})},
   "/computers/{id}/recordings/{recordingId}":{get:read("Recording status and artifact metadata",ref("Recording"),[id,recordingId]),delete:write("Delete stopped recording artifact",[id,recordingId,idem])},
   "/computers/{id}/recordings/{recordingId}/stop":{post:write("Request recording stop",[id,recordingId,idem])},
   "/computers/{id}/recordings/{recordingId}/file":{get:{summary:"Retrieve completed owned MP4 artifact",parameters:[id,recordingId],responses:{"200":{description:"Playable video file",content:{"video/mp4":{schema:{type:"string",format:"binary"}}}},...errors}}},
   "/computers/{id}/input":{post:{...write("Submit self-contained bounded input batch; accepted events are not guest completion",[id,idem],{required:true,content:json(ref("InputBatch"))}),security:[{DisplayTicket:[]}]}},
   "/computers/{id}/input-lease":{get:read("Current input authority; account scoped",object,[id]),post:{...read("Acquire or renew control ticket lease; human may take over automation",object,[id]),security:[{DisplayTicket:[]}],requestBody:{required:false,content:json({type:"object",additionalProperties:false,properties:{takeover:{type:"boolean"}}})}},delete:{...read("Release caller control ticket lease",object,[id]),security:[{DisplayTicket:[]}]}},
   "/computers/{id}/vnc":{get:{summary:"Shared RFB over authenticated WSS; key and pointer events require current control-ticket lease",parameters:[id],security:[{DisplayTicket:[]}],servers:[{url:"https://{gatewayHost}:3443/api/v1",variables:{gatewayHost:{default:"localhost"}}}],"x-websocket":true,responses:{"101":{description:"Authorized RFB WebSocket upgrade"},...errors}}},
   "/computers/{id}/screenshot":{get:{security:[{TestBearer:[]},{DisplayTicket:[]}],summary:"Capture current owned running VMI display without input or storage",parameters:[id],responses:{"200":{description:"PNG display screenshot; no-store",content:{"image/png":{schema:{type:"string",format:"binary"}}}},...errors}}},
   "/computers/{id}/guest":{get:read("Inspect sanitized KubeVirt guest status evidence",ref("GuestObservation"),[id])},
   "/computers/{id}/start":lifecycle("Start"),
   "/computers/{id}/stop":lifecycle("Stop"),
   "/computers/{id}/restart":lifecycle("Restart"),
   "/computers/{id}/reset":{post:write("Hard reset current VMI; unsaved guest data can be lost; verify guest boot separately",[id,idem],{required:true,content:json({type:"object",additionalProperties:false,required:["confirmHardReset","instanceUid"],properties:{confirmHardReset:{const:true},instanceUid:{type:"string",format:"uuid"}}})})},
   "/operations":{get:read("Latest 100 account-owned operation records",{type:"array",items:ref("Operation")})},
   "/operations/{id}":{get:read("Read durable submission and observed convergence independently; no automatic mutation replay",ref("Operation"),[opId])}
  },
  components:{
   securitySchemes:{NetworkGrant:{type:"apiKey",in:"header",name:"Authorization",description:"Network <grant>; private VM-scoped TCP tunnel only"},DisplayTicket:{type:"apiKey",in:"header",name:"Authorization",description:"Console <ticket>; VM-scoped screenshot/observer/control grant, no account authority"},TestBearer:{type:"http",scheme:"bearer",description:"Isolated test identity or scoped account API key; not production authentication"}},
   schemas:{
    DisplayTicket:{type:"object",required:["id","computerId","scope","actor","instanceUid","createdAt","expiresAt","revokedAt"],properties:{id:{type:"string",format:"uuid"},computerId:{type:"string"},scope:{enum:["screenshot-only","observe-vnc","control-vnc"]},actor:{enum:["observer","human","automation"]},instanceUid:{type:"string"},createdAt:{type:"string",format:"date-time"},expiresAt:{type:"string",format:"date-time"},revokedAt:{type:["string","null"],format:"date-time"}}},
    DisplayTicketSecret:{allOf:[ref("DisplayTicket"),{type:"object",required:["token","authorizationScheme"],properties:{token:{type:"string"},authorizationScheme:{const:"Console"}}}]},
    AccountKeySpec:keySchema,
    AccountKey:{type:"object",required:["id","label","permission","createdAt","expiresAt","revokedAt","lastUsedAt"],properties:{id:{type:"string",format:"uuid"},label:{type:"string"},permission:{enum:["read","manage"]},createdAt:{type:"string",format:"date-time"},expiresAt:{type:"string",format:"date-time"},revokedAt:{type:["string","null"],format:"date-time"},lastUsedAt:{type:["string","null"],format:"date-time"}}},
    AccountKeySecret:{allOf:[ref("AccountKey"),{type:"object",required:["token"],properties:{token:{type:"string",writeOnly:true}}}]},
    CatalogImage:{type:"object",required:["id","os","version","architecture","format","source","image","digest","integrity","licensing","support","evidence"],properties:{id:{type:"string"},os:{type:"string"},version:{type:["string","null"]},architecture:{enum:["amd64","arm64"]},format:{type:"string"},source:{type:"string",format:"uri"},image:{type:"string"},digest:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},integrity:{type:"string"},licensing:object,support:{type:"string"},evidence:object}},
    ExposureSpec:exposureSchema,
    InputBatch:batchSchema,
    RecordingSpec:recordingSchema,
    Recording:{type:"object",required:["id","computerId","instanceUid","status","consentAt","maxSeconds","createdAt"],properties:{id:{type:"string",format:"uuid"},computerId:{type:"string"},instanceUid:{type:"string"},status:{enum:["queued","recording","stopping","completed","failed","deleted"]},consentAt:{type:"string",format:"date-time"},createdAt:{type:"string",format:"date-time"},maxSeconds:{type:"integer"},durationMs:{type:["integer","null"]},bytes:{type:["integer","null"]},sha256:{type:["string","null"]},contentType:{type:["string","null"]},error:{type:["string","null"]}}},
    ExchangeFile:{type:"object",required:["name","size","sha256","direction"],properties:{name:{type:"string"},size:{type:"integer",minimum:0,maximum:8388608},sha256:{type:"string",pattern:"^[0-9a-f]{64}$"},direction:{enum:["upload","download"]},guestReference:{type:"string"}}},
    ComputerSpec:computer,
    AdvancedComputerSpec:advanced,
    Quota:{type:"object",required:["limits","usage"],properties:{limits:ref("QuotaUsage"),usage:ref("QuotaUsage")}},
    QuotaUsage:{type:"object",required:["computers","cpu","memoryMiB","storageGiB"],properties:Object.fromEntries(["computers","cpu","memoryMiB","storageGiB"].map(k=>[k,{type:"integer",minimum:0}]))},
    BootSpec:boot,
    HardwareSpec:hardware,
    DataDiskSpec:disk,
    Error:{type:"object",required:["error"],properties:{error:{type:"string"},issues:{type:"array",items:object}}},
    Submission:{type:"object",required:["operationId","status","result"],properties:{operationId:{type:"string",format:"uuid"},status:{type:"string",enum:["pending","submitted","rejected","unknown"]},result:{}}},
    Operation:{type:"object",required:["id","status","result","createdAt"],properties:{id:{type:"string",format:"uuid"},status:{type:"string",enum:["pending","submitted","rejected","unknown"]},result:{},intent:{anyOf:[object,{type:"null"}]},observation:{anyOf:[object,{type:"null"}]},observedAt:{type:["string","null"],format:"date-time"},createdAt:{type:"string",format:"date-time"},updatedAt:{type:"string",format:"date-time"}}},
    ComputerSummary:{type:"object",required:["id","desired"],properties:{id:{type:"string"},desired:object,status:object}},
    ComputerDetail:{type:"object",required:["id","resourceVersion","desired","instance"],properties:{id:{type:"string"},resourceVersion:{type:"string"},desired:object,status:object,instance:{anyOf:[object,{type:"null"}]}}},
    GuestObservation:{type:"object",required:["id","available","phase","ready","conditions","guestOS","interfaces","volumes","evidenceLevel","console","observedAt"],properties:{id:{type:"string"},available:{type:"boolean"},phase:{type:["string","null"]},ready:{type:"boolean"},conditions:{type:"array",items:object},guestOS:{anyOf:[object,{type:"null"}]},interfaces:{type:"array",items:object},volumes:{type:"array",items:object},evidenceLevel:{type:"string",enum:["kubevirt-status-only"]},console:object,observedAt:{type:"string",format:"date-time"}}}
   }
  }
 };
}
