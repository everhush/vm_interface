import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {isMain} from "./tooling.ts";
// This renderer is intentionally independent of application dependencies so
// an operator can review manifests before deploying on a dedicated cluster.
const digestImage=/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?\/[a-z0-9]+(?:[a-z0-9._/-]*[a-z0-9])?@sha256:[a-f0-9]{64}$/;
function replaceCount(s:string,from:string,to:string,count:number){
 if(s.split(from).length!==count+1)throw Error("Unexpected base manifest anchor: "+from);
 return s.replaceAll(from,to);
}
export function renderManaged(base:{namespace:string;app:string;exchange:string;exportPolicy:string},image:string){
 if(!digestImage.test(image)||image.includes("//")||image.includes("/../")||image.includes("/./"))throw Error("Fully qualified immutable registry image required");
 let ns=replaceCount(base.namespace,"storageClassName: local-path","storageClassName: vm-managed",3);
 ns=replaceCount(ns,"storage:\n    size: 2Gi","storage:\n    storageClass: vm-managed\n    size: 2Gi",1);
 let app=replaceCount(base.app,"image: localhost/vm-interface:ci","image: "+image,4);
 app=replaceCount(app,"imagePullPolicy: Never","imagePullPolicy: IfNotPresent",4);
 for(const name of ["api","reconcile"]){
  const anchor="      - name: "+name+"\n";
  const i=app.indexOf(anchor), next=app.indexOf("\n      - name:",i+anchor.length), end=next<0?app.length:next;
  if(i<0)throw Error("Container anchor absent: "+name);
  const block=app.slice(i,end);
  const vars='        - name: VM_STORAGE_CLASS\n          value: "vm-managed"\n'+(name==="api"?'        - name: VM_BROKER_IMAGE\n          value: "'+image+'"\n':"");
  app=app.slice(0,i)+replaceCount(block,"        env:\n","        env:\n"+vars,1)+app.slice(end);
 }
 let exchange=replaceCount(base.exchange,"'localhost/vm-interface:ci'","'"+image+"'",1);
 exchange=replaceCount(exchange,"imagePullPolicy == 'Never'","imagePullPolicy == 'IfNotPresent'",1);
 exchange=replaceCount(exchange,"['local-path','vm-expandable']","['vm-managed']",2);
 return {namespace:ns,app,exchange,exportPolicy:base.exportPolicy};
}
if(isMain(import.meta.url)){
 const {values}=parseArgs({options:{image:{type:"string"},output:{type:"string"}},strict:true});
 if(!values.image||!values.output)throw Error("Usage: node scripts/render-managed-kubernetes.ts --image registry/repo@sha256:... --output NEW_DIRECTORY");
 const read=(p:string)=>readFileSync(new URL("../infra/"+p,import.meta.url),"utf8");
 const result=renderManaged({namespace:read("namespace.yaml"),app:read("app.yaml"),exchange:read("exchange-policy.yaml"),exportPolicy:read("disk-export-policy.yaml")},values.image);
 mkdirSync(values.output,{mode:0o700});
 for(const [name,content] of Object.entries(result))writeFileSync(join(values.output,name+".yaml"),content,{flag:"wx"});
}
