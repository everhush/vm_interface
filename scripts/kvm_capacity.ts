import { readFileSync } from "node:fs";
import { isMain } from "./tooling.ts";
const decimal: Record<string,number> = {n:-9,u:-6,m:-3,"":0,k:3,M:6,G:9,T:12,P:15,E:18};
const binary: Record<string,number> = Object.fromEntries(Array.from("KMGTPE",(s,i)=>[s+"i",1024**(i+1)]));
function exactQuantity(raw: unknown): {numerator:bigint;denominator:bigint} {
  const m = /^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))([eE][+-]?[0-9]+|[numkMGTPE]|[KMGTPE]i)?$/.exec(String(raw));
  if (!m) throw Error("Invalid Kubernetes quantity: "+String(raw));
  const suffix=m[2]??"";
  const negative=m[1].startsWith("-");
  const [whole,frac=""]=m[1].replace(/^[+-]/,"").split(".");
  if(whole.length+frac.length>128)throw Error("Quantity out of range");
  const coefficient=BigInt((whole+frac)||"0")*(negative?-1n:1n);
  const exponent=Object.hasOwn(decimal,suffix)?decimal[suffix]:Object.hasOwn(binary,suffix)?0:Number(suffix.slice(1));
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>128)throw Error("Quantity out of range");
  const factor=Object.hasOwn(binary,suffix)?BigInt(binary[suffix]):1n;
  const scale=exponent-frac.length;
  return {numerator:coefficient*factor*(scale>=0?10n**BigInt(scale):1n),denominator:scale<0?10n**BigInt(-scale):1n};
}
export function quantity(raw:unknown):number {
  const q=exactQuantity(raw);
  return Number(q.numerator)/Number(q.denominator);
}
type Node = {metadata:{name:string;labels?:Record<string,string>};status:{allocatable?:Record<string,string>;conditions?:{type:string;status:string}[]}};
export function eligibleNodes(document:{items:Node[]}) {
  return document.items.flatMap(n=>{
    const q=exactQuantity(n.status.allocatable?.["devices.kubevirt.io/kvm"]??"0");
    const count=q.numerator/q.denominator;
    const ready=n.status.conditions?.some(c=>c.type==="Ready"&&c.status==="True");
    return q.numerator%q.denominator===0n&&count>=1n&&ready&&n.metadata.labels?.["kubevirt.io/schedulable"]==="true"?[{name:n.metadata.name,kvm:String(count)}]:[];
  });
}
if(isMain(import.meta.url)){
  const nodes=eligibleNodes(JSON.parse(readFileSync(0,"utf8")));
  console.log(JSON.stringify(nodes));
  if(!nodes.length){console.error("No ready schedulable node with allocatable KVM device");process.exitCode=1}
}
