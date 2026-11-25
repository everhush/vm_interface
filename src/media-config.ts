/** Operator-controlled capacity; ordinary CI defaults remain small. */
export const MiB=1024*1024,GiB=1024*MiB;
export function boundedInteger(value:string|undefined,fallback:number,min:number,max:number,name:string){
 if(value===undefined)return fallback;
 if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw Error("Invalid operator capacity "+name);
 return Number(value);
}
export const mediaMaxBytes=boundedInteger(process.env.VM_MEDIA_MAX_MIB,64,64,8192,"VM_MEDIA_MAX_MIB")*MiB;
export const stageMaxBytes=boundedInteger(process.env.VM_MEDIA_STAGE_MAX_MIB,256,256,16384,"VM_MEDIA_STAGE_MAX_MIB")*MiB;
export const systemMaxGiB=boundedInteger(process.env.VM_SYSTEM_MAX_GIB,8,8,64,"VM_SYSTEM_MAX_GIB");
export const accountMaxStorageGiB=boundedInteger(process.env.VM_ACCOUNT_STORAGE_GIB,16,16,128,"VM_ACCOUNT_STORAGE_GIB");
export const mediaChunkBytes=8*MiB;
export function installerGiB(bytes:number){
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>8*GiB)throw Error("Invalid declared installer size");
 return Math.max(1,Math.ceil((bytes+64*MiB)/(0.90*GiB)));
}
