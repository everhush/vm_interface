import type {Resource} from "./kube";

type JsonRecord=Record<string,unknown>;
export type GuestObservation={
  available:boolean;
  phase:string|null;
  ready:boolean;
  conditions:Array<{type:string|null;status:string|null;reason:string|null}>;
  guestOS:{id:string|null;name:string|null;version:string|null;kernelRelease:string|null}|null;
  interfaces:Array<{name:string|null;interfaceName:string|null;ipAddress:string|null;mac:string|null}>;
  volumes:Array<{name:string|null;phase:string|null;target:string|null;reason:string|null}>;
  evidenceLevel:"kubevirt-status-only";
  console:{supported:boolean;reason:string};
  observedAt:string;
};

function asRecord(value:unknown):JsonRecord|null{
  return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as JsonRecord:null;
}
function records(value:unknown):JsonRecord[]{
  if(!Array.isArray(value))return [];
  return value.map(asRecord).filter((item):item is JsonRecord=>item!==null);
}
function text(value:unknown):string|null{return typeof value==="string"?value:null;}
function field(item:JsonRecord,key:string):string|null{return text(item[key]);}

export function guestObservation(id:string,vmi:Resource|null,observedAt=new Date().toISOString()):GuestObservation&{id:string}{
  const status=asRecord(vmi?.status);
  const conditionRecords=records(status?.conditions);
  const conditions=conditionRecords.map(item=>({type:field(item,"type"),status:field(item,"status"),reason:field(item,"reason")}));
  const guestOSRecord=asRecord(status?.guestOSInfo);
  const guestOS=guestOSRecord?{
    id:field(guestOSRecord,"id"),
    name:field(guestOSRecord,"name"),
    version:field(guestOSRecord,"version"),
    kernelRelease:field(guestOSRecord,"kernelRelease")
  }:null;
  const interfaces=records(status?.interfaces).map(item=>({
    name:field(item,"name"),
    interfaceName:field(item,"interfaceName"),
    ipAddress:field(item,"ipAddress"),
    mac:field(item,"mac")
  }));
  const volumes=records(status?.volumeStatus).map(item=>({
    name:field(item,"name"),
    phase:field(item,"phase"),
    target:field(item,"target"),
    reason:field(item,"reason")
  }));
  return {
    id,
    available:vmi!==null,
    phase:field(status??{},"phase"),
    ready:conditions.some(item=>item.type==="Ready"&&item.status==="True"),
    conditions,
    guestOS,
    interfaces,
    volumes,
    evidenceLevel:"kubevirt-status-only",
    console:field(status??{},"phase")==="Running"?{supported:true,reason:"Console access requires a separate authorized ticket; status alone does not establish guest readiness."}:{supported:false,reason:"A running VMI is required for console access."},
    observedAt
  };
}
