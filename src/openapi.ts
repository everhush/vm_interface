import { schema } from "./spec";
import {z} from "zod";
import {keySpec} from "./account-keys";
import {recordingSpec} from "./recordings";
import {batchSpec} from "./input-batch";
import {hardwareSchema} from "./hardware";

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
 "500":response("Internal service error",ref("Error")),
 "502":response("Upstream Kubernetes error",ref("Error"))
};
const id = {name:"id",in:"path",required:true,schema:{type:"string",pattern:"^vm-[a-f0-9]{32}$"}};
const opId = {name:"id",in:"path",required:true,schema:{type:"string",format:"uuid"}};
const idem = {name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:128,pattern:"^[A-Za-z0-9_.:-]+$"}};
const deleteDisks={name:"deleteDisks",in:"query",required:false,schema:{type:"boolean"},description:"Must explicitly be true when deleting a VM with persistent disks; all its managed disks are affected"};
const hardwareBody={required:true,content:json(ref("HardwareSpec"))};
const body = {required:true,content:json(ref("ComputerSpec"))};
const read = (summary:string,schema:unknown=object,parameters:unknown[]=[])=>({summary,parameters,responses:{"200":response("Success",schema),...errors}});
const write = (summary:string,parameters:unknown[],requestBody?:unknown)=>({summary,parameters,...(requestBody?{requestBody}:{}),responses:{"202":response("Mutation recorded; submission is not completion. Replaying rejected submissions returns the recorded HTTP rejection.",ref("Submission")),...errors}});
const lifecycle = (name:string)=>({post:write(name+" computer; poll computer state to verify convergence",[id,idem])});
export function openApiDocument(){
 const computer = {...schema}; delete computer.$schema;
 const hardware={...hardwareSchema};delete hardware.$schema;
 const keySchema=z.toJSONSchema(keySpec);delete keySchema.$schema;
 const recordingSchema=z.toJSONSchema(recordingSpec);delete recordingSchema.$schema;
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
   "/account/quota":{get:read("Owned computer desired-resource quota and current reservations",ref("Quota"))},
   "/schema":{get:read("ComputerSpec JSON Schema")},
   "/images":{get:read("Allowlisted image catalog with immutable OCI references and qualification status",{type:"array",items:ref("CatalogImage")})},
   "/capabilities":{get:read("Implemented, conditional and unsupported capabilities")},
   "/openapi.json":{get:read("OpenAPI document")},
   "/computers/plan":{post:{...read("Validate and server-side dry-run the configuration"),requestBody:body}},
   "/computers":{get:read("List owned computers",{type:"array",items:ref("ComputerSummary")}),post:write("Create a halted computer",[idem],body)},
   "/computers/{id}":{get:read("Inspect desired and current VM/VMI state",ref("ComputerDetail"),[id]),delete:write("Delete owned computer; explicit confirmation for persistent disks",[id,idem,deleteDisks])},
   "/computers/{id}/hardware":{patch:write("Change CPU and RAM on a fully stopped computer; optimistic resource version required",[id,idem],hardwareBody)},
   "/computers/{id}/hardware/plan":{post:{...read("Server-side dry-run of cold CPU/RAM change",object,[id]),requestBody:hardwareBody}},
   "/computers/{id}/files":{get:read("List fully published guest output files",{type:"array",items:ref("ExchangeFile")},[id])},
   "/computers/{id}/files/{name}":{get:{summary:"Download verified guest output bytes",parameters:[id,{name:"name",in:"path",required:true,schema:{type:"string"}}],responses:{"200":{description:"Verified output",content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},...errors}},put:write("Upload actual bytes atomically into the exchange volume",[id,idem,{name:"name",in:"path",required:true,schema:{type:"string"}},{name:"X-Content-SHA256",in:"header",required:true,schema:{type:"string",pattern:"^[0-9a-f]{64}$"}}],{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",maxLength:8388608}}}})},
   "/computers/{id}/storage":{get:read("Inspect account-owned managed DataVolumes and PVCs",object,[id])},
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
   "/operations/{id}":{get:read("Read durable operation submission record",ref("Operation"),[opId])}
  },
  components:{
   securitySchemes:{DisplayTicket:{type:"apiKey",in:"header",name:"Authorization",description:"Console <ticket>; VM-scoped screenshot/observer/control grant, no account authority"},TestBearer:{type:"http",scheme:"bearer",description:"Isolated test identity or scoped account API key; not production authentication"}},
   schemas:{
    DisplayTicket:{type:"object",required:["id","computerId","scope","actor","instanceUid","createdAt","expiresAt","revokedAt"],properties:{id:{type:"string",format:"uuid"},computerId:{type:"string"},scope:{enum:["screenshot-only","observe-vnc","control-vnc"]},actor:{enum:["observer","human","automation"]},instanceUid:{type:"string"},createdAt:{type:"string",format:"date-time"},expiresAt:{type:"string",format:"date-time"},revokedAt:{type:["string","null"],format:"date-time"}}},
    DisplayTicketSecret:{allOf:[ref("DisplayTicket"),{type:"object",required:["token","authorizationScheme"],properties:{token:{type:"string"},authorizationScheme:{const:"Console"}}}]},
    AccountKeySpec:keySchema,
    AccountKey:{type:"object",required:["id","label","permission","createdAt","expiresAt","revokedAt","lastUsedAt"],properties:{id:{type:"string",format:"uuid"},label:{type:"string"},permission:{enum:["read","manage"]},createdAt:{type:"string",format:"date-time"},expiresAt:{type:"string",format:"date-time"},revokedAt:{type:["string","null"],format:"date-time"},lastUsedAt:{type:["string","null"],format:"date-time"}}},
    AccountKeySecret:{allOf:[ref("AccountKey"),{type:"object",required:["token"],properties:{token:{type:"string",writeOnly:true}}}]},
    CatalogImage:{type:"object",required:["id","os","version","architecture","format","source","image","digest","integrity","licensing","support","evidence"],properties:{id:{type:"string"},os:{type:"string"},version:{type:["string","null"]},architecture:{enum:["amd64","arm64"]},format:{type:"string"},source:{type:"string",format:"uri"},image:{type:"string"},digest:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},integrity:{type:"string"},licensing:object,support:{type:"string"},evidence:object}},
    InputBatch:batchSchema,
    RecordingSpec:recordingSchema,
    Recording:{type:"object",required:["id","computerId","instanceUid","status","consentAt","maxSeconds","createdAt"],properties:{id:{type:"string",format:"uuid"},computerId:{type:"string"},instanceUid:{type:"string"},status:{enum:["queued","recording","stopping","completed","failed","deleted"]},consentAt:{type:"string",format:"date-time"},createdAt:{type:"string",format:"date-time"},maxSeconds:{type:"integer"},durationMs:{type:["integer","null"]},bytes:{type:["integer","null"]},sha256:{type:["string","null"]},contentType:{type:["string","null"]},error:{type:["string","null"]}}},
    ExchangeFile:{type:"object",required:["name","size","sha256","direction"],properties:{name:{type:"string"},size:{type:"integer",minimum:0,maximum:8388608},sha256:{type:"string",pattern:"^[0-9a-f]{64}$"},direction:{enum:["upload","download"]},guestReference:{type:"string"}}},
    ComputerSpec:computer,
    Quota:{type:"object",required:["limits","usage"],properties:{limits:ref("QuotaUsage"),usage:ref("QuotaUsage")}},
    QuotaUsage:{type:"object",required:["computers","cpu","memoryMiB","storageGiB"],properties:Object.fromEntries(["computers","cpu","memoryMiB","storageGiB"].map(k=>[k,{type:"integer",minimum:0}]))},
    HardwareSpec:hardware,
    Error:{type:"object",required:["error"],properties:{error:{type:"string"},issues:{type:"array",items:object}}},
    Submission:{type:"object",required:["operationId","status","result"],properties:{operationId:{type:"string",format:"uuid"},status:{type:"string",enum:["pending","submitted","rejected","unknown"]},result:{}}},
    Operation:{type:"object",required:["id","status","result","createdAt"],properties:{id:{type:"string",format:"uuid"},status:{type:"string",enum:["pending","submitted","rejected","unknown"]},result:{},createdAt:{type:"string",format:"date-time"}}},
    ComputerSummary:{type:"object",required:["id","desired"],properties:{id:{type:"string"},desired:object,status:object}},
    ComputerDetail:{type:"object",required:["id","resourceVersion","desired","instance"],properties:{id:{type:"string"},resourceVersion:{type:"string"},desired:object,status:object,instance:{anyOf:[object,{type:"null"}]}}},
    GuestObservation:{type:"object",required:["id","available","phase","ready","conditions","guestOS","interfaces","volumes","evidenceLevel","console","observedAt"],properties:{id:{type:"string"},available:{type:"boolean"},phase:{type:["string","null"]},ready:{type:"boolean"},conditions:{type:"array",items:object},guestOS:{anyOf:[object,{type:"null"}]},interfaces:{type:"array",items:object},volumes:{type:"array",items:object},evidenceLevel:{type:"string",enum:["kubevirt-status-only"]},console:object,observedAt:{type:"string",format:"date-time"}}}
   }
  }
 };
}
