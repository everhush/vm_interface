import { readFileSync } from "node:fs";
import { isMain } from "./tooling.ts";
const decimal: Record<string,number> = {n:-9,u:-6,m:-3,"":0,k:3,M:6,G:9,T:12,P:15,E:18};
const binary: Record<string,number> = Object.fromEntries(Array.from("KMGTPE",(s,i)=>[s+"i",1024**(i+1)]));
export function quantity(raw: unknown): number {
  const m = /^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))([eE][+-]?[0-9]+|[numkMGTPE]|[KMGTPE]i)?$/.exec(String(raw));
  if (!m) throw Error("Invalid Kubernetes quantity: "+String(raw));
  const suffix=m[2]??"";
  const v=Number(m[1])*(Object.hasOwn(decimal,suffix)?10**decimal[suffix]:Object.hasOwn(binary,suffix)?binary[suffix]:10**Number(suffix.slice(1)));
  if (!Number.isFinite(v)) throw Error("Quantity out of range");
  return v;
}
type Node = {metadata:{name:string;labels?:Record<string,string>};status:{allocatable?:Record<string,string>;conditions?:{type:string;status:string}[]}};
export function eligibleNodes(document:{items:Node[]}) {
  return document.items.flatMap(n=>{
    const count=quantity(n.status.allocatable?.["devices.kubevirt.io/kvm"]??"0");
    const ready=n.status.conditions?.some(c=>c.type==="Ready"&&c.status==="True");
    return Number.isSafeInteger(count)&&count>=1&&ready&&n.metadata.labels?.["kubevirt.io/schedulable"]==="true"?[{name:n.metadata.name,kvm:String(count)}]:[];
  });
}
if(isMain(import.meta.url)){
  const nodes=eligibleNodes(JSON.parse(readFileSync(0,"utf8")));
  console.log(JSON.stringify(nodes));
  if(!nodes.length){console.error("No ready schedulable node with allocatable KVM device");process.exitCode=1}
}
