import {ApiError} from "./kube";
export const LOCAL_IMAGE="localhost/vm-interface:ci";
export function managedImage(value:string):boolean{
 return /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?\/[a-z0-9]+(?:[a-z0-9._/-]*[a-z0-9])?@sha256:[a-f0-9]{64}$/.test(value) && !value.includes("//") && !value.includes("/../") && !value.includes("/./");
}
export function brokerImage(value=process.env.VM_BROKER_IMAGE??LOCAL_IMAGE):{image:string;imagePullPolicy:"Never"|"IfNotPresent"}{
 if(value===LOCAL_IMAGE)return {image:value,imagePullPolicy:"Never"};
 if(!managedImage(value))throw new ApiError(502,"Invalid operator broker image; immutable registry digest required");
 return {image:value,imagePullPolicy:"IfNotPresent"};
}
