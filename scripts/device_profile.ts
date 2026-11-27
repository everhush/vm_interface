import {readFileSync} from "node:fs";
import {isMain} from "./tooling.ts";
const large=new Set(["windows","android"]);
const profiles=new Set(["core","linux",...large]);
const stage="20Gi";
const ENV={VM_MEDIA_MAX_MIB:"8192",VM_MEDIA_STAGE_MAX_MIB:"16384",VM_SYSTEM_MAX_GIB:"64",VM_ACCOUNT_STORAGE_GIB:"128",VM_ENABLE_GUEST_EXCHANGE_EVALUATION:"true"};
export function namespace(source:string,profile:string){
  if(!large.has(profile))return source;
  const docs=source.split("\n---\n");
  const matches=docs.map((d,i)=>d.includes("\nkind: PersistentVolumeClaim\n")&&d.includes("\n  name: vm-media-stage\n")?i:-1).filter(i=>i>=0);
  if(matches.length!==1)throw Error("Expected exactly one media stage PVC");
  const i=matches[0],before="requests: {storage: 512Mi}";
  if(docs[i].split(before).length!==2)throw Error("Unexpected base storage request");
  docs[i]=docs[i].replace(before,"requests: {storage: "+stage+"}");
  return docs.join("\n---\n");
}
function environment(profile:string):Record<string,Record<string,string>>{
  if(!large.has(profile))throw Error("Large-media profile required");
  return {api:{...ENV,...(profile==="android"?{VM_ENABLE_ARM64_EVALUATION:"true"}:{})},reconcile:{...ENV}};
}
type Deployment={spec:{template:{spec:{containers:{name:string;env?:{name:string;value?:string}[]}[]}}}};
export function deployment(profile:string):Deployment{
  return {spec:{template:{spec:{containers:Object.entries(environment(profile)).map(([name,env])=>({name,env:Object.entries(env).map(([name,value])=>({name,value}))}))}}}};
}
export function verifyDeployment(value:Deployment,profile:string){
  for(const [name,expected] of Object.entries(environment(profile))){
    const env=value.spec.template.spec.containers.find(c=>c.name===name)?.env??[];
    for(const [key,v] of Object.entries(expected)){
      const matches=env.filter(e=>e.name===key);
      if(matches.length!==1||matches[0].value!==v||Object.keys(matches[0]).length!==2)throw Error("Missing or incorrect configuration: "+name+"/"+key);
    }
  }
}
export function verifyPvc(value:{metadata:{name:string};spec:{resources:{requests:{storage:string}}}},profile:string){
  if(value.metadata.name!=="vm-media-stage"||value.spec.resources.requests.storage!==(large.has(profile)?stage:"512Mi"))throw Error("Incorrect media staging reservation");
}
if(isMain(import.meta.url)){
  const [action,profile]=process.argv.slice(2);
  if(process.argv.length!==4||!profiles.has(profile)||!["namespace","deployment","verify-deployment","verify-pvc"].includes(action))throw Error("Invalid action or profile");
  if(large.has(profile)&&process.env.VM_DISPOSABLE_DEVICE!=="true")throw Error("Large-media settings require an explicitly disposable device");
  if(action==="namespace")process.stdout.write(namespace(readFileSync(new URL("../infra/namespace.yaml",import.meta.url),"utf8"),profile));
  else if(action==="deployment")console.log(JSON.stringify(deployment(profile)));
  else if(action==="verify-deployment")verifyDeployment(JSON.parse(readFileSync(0,"utf8")),profile);
  else verifyPvc(JSON.parse(readFileSync(0,"utf8")),profile);
}
