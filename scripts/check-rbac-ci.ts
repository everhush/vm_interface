import {execFileSync,spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
import {parseArgs} from "node:util";
const {values}=parseArgs({options:{context:{type:"string"},"storage-class":{type:"string",default:"local-path"}},strict:true});
const base=values.context?["--context",values.context]:[];
const storage=values["storage-class"];
assert(["local-path","vm-managed","vm-expandable"].includes(storage!));
const checks=[["subresources.kubevirt.io","virtualmachineinstances","vnc","get",true],["subresources.kubevirt.io","virtualmachineinstances","vnc/screenshot","get",true],["subresources.kubevirt.io","virtualmachineinstances","console","get",false],["subresources.kubevirt.io","virtualmachineinstances","vnc","update",false],["subresources.kubevirt.io","virtualmachineinstances","reset","update",true],["subresources.kubevirt.io","virtualmachineinstances","reset","get",false],["subresources.kubevirt.io","virtualmachineinstances","portforward","get",true],["subresources.kubevirt.io","virtualmachineinstances","portforward","update",false],["","secrets","","get",false],["","secrets","","create",false],["export.kubevirt.io","virtualmachineexports","","create",true],["export.kubevirt.io","virtualmachineexports","","patch",false],["","pods","exec","create",false],["","pods","proxy","get",false],["","pods","","create",true],["","pods","","delete",false],["","persistentvolumeclaims","","create",true],["","persistentvolumeclaims","","patch",false],["upload.cdi.kubevirt.io","uploadtokenrequests","","create",true],["cdi.kubevirt.io","datavolumes","","create",true],["cdi.kubevirt.io","datavolumes","","delete",false],["cdi.kubevirt.io","datavolumes","","patch",false]] as const;
const evidence:unknown[]=[];
for(const [group,resource,subresource,verb,allowed] of checks){
 const attrs={namespace:"vm-interface",group,resource,verb,name:"vm-rbac-probe",...(subresource?{subresource}:{})};
 const review={apiVersion:"authorization.k8s.io/v1",kind:"SubjectAccessReview",spec:{user:"system:serviceaccount:vm-interface:vm-api",groups:["system:serviceaccounts","system:serviceaccounts:vm-interface","system:authenticated"],resourceAttributes:attrs}};
 const result=JSON.parse(execFileSync("kubectl",[...base,"create","--raw","/apis/authorization.k8s.io/v1/subjectaccessreviews","-f","-"],{input:JSON.stringify(review),encoding:"utf8",timeout:30000})).status;
 assert((result.allowed??false)===allowed&&!result.evaluationError,JSON.stringify({attrs,result}));
 evidence.push({attributes:attrs,allowed});
}
const deniedCases=[
 {apiVersion:"v1",kind:"Pod",spec:{containers:[{name:"bad",image:"busybox",securityContext:{privileged:true}}]},policy:"vm-exchange"},
 {apiVersion:"v1",kind:"PersistentVolumeClaim",spec:{accessModes:["ReadWriteOnce"],resources:{requests:{storage:"50Gi"}}},policy:"vm-exchange"},
 {apiVersion:"cdi.kubevirt.io/v1beta1",kind:"DataVolume",spec:{source:{blank:{}},storage:{storageClassName:storage,accessModes:["ReadWriteOnce"],volumeMode:"Filesystem",resources:{requests:{storage:"1Gi"}}}},policy:"vm-data-disk"},
 {apiVersion:"export.kubevirt.io/v1",kind:"VirtualMachineExport",spec:{source:{kind:"PersistentVolumeClaim",name:"foreign-pvc"},tokenSecretRef:"vm-api-export",ttlDuration:"15m0s"},policy:"vm-disk-export"}
];
for(const {policy,...obj} of deniedCases){
 const r=spawnSync("kubectl",[...base,"--as=system:serviceaccount:vm-interface:vm-api","create","--dry-run=server","-f","-"],{input:JSON.stringify({...obj,metadata:{name:"forbidden-probe",namespace:"vm-interface"}}),encoding:"utf8",timeout:30000});
 assert(!r.error&&r.status!==null&&r.status!==0&&r.stderr.includes(policy),obj.kind+": "+r.stderr);
 evidence.push({kind:obj.kind,unsafeCreateDeniedByAdmission:true});
}
mkdirSync("evidence",{recursive:true});writeFileSync("evidence/rbac-checks.json",JSON.stringify(evidence,null,2));console.log("Exact screenshot RBAC and forbidden access checks passed");
