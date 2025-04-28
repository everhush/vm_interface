import {z} from "zod";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {and,eq,gt,gte,isNull,lte,sql} from "drizzle-orm";
import {database,networkGrants,accountKeys} from "./db";
import {ApiError,owned,type Resource} from "./kube";
import {runningDisplay} from "./screenshot";
export const exposureSpec=z.strictObject({port:z.number().int().min(1).max(65535),ttlSeconds:z.number().int().min(10).max(600).default(120),access:z.literal("private-tunnel")});
export type ExposureSpec=z.infer<typeof exposureSpec>;
type Grant=typeof networkGrants.$inferSelect;
const hash=(t:string)=>createHash("sha256").update(t).digest("hex");
export function privateNetwork(vm:Resource){
 const spec=vm.spec as {template?:{spec?:{networks?:{name?:string;pod?:object}[];domain?:{devices?:{interfaces?:{name?:string;masquerade?:object}[]}}}}};
 return spec?.template?.spec?.networks?.length===1&&spec.template.spec.networks[0].name==="private"&&!!spec.template.spec.networks[0].pod&&spec.template.spec.domain?.devices?.interfaces?.length===1&&spec.template.spec.domain.devices.interfaces[0].name==="private"&&!!spec.template.spec.domain.devices.interfaces[0].masquerade;
}
export function networkToken(header:string|null,protocols:string[]=[]){
 const fromHeader=/^Network ([A-Za-z0-9_-]{43})$/.exec(header??"")?.[1]??null;
 const matches=protocols.filter(p=>/^vm-network\.[A-Za-z0-9_-]{43}$/.test(p));
 const fromProtocol=matches.length===1?matches[0].slice("vm-network.".length):null;
 if(matches.length>1||fromHeader&&fromProtocol&&fromHeader!==fromProtocol)return null;
 return fromHeader??fromProtocol;
}
export function validNetworkGrant(g:Pick<Grant,"id"|"computerId"|"expiresAt"|"revokedAt">,id:string,computerId:string,now=Date.now()){
 return g.id===id&&g.computerId===computerId&&!g.revokedAt&&g.expiresAt.getTime()>now;
}
function publicGrant(g:Grant){
 return {id:g.id,computerId:g.computerId,instanceUid:g.instanceUid,port:g.port,access:"private-tunnel",protocol:"tcp",createdAt:g.createdAt,expiresAt:g.expiresAt,revokedAt:g.revokedAt,active:validNetworkGrant(g,g.id,g.computerId),path:"/api/v1/computers/"+g.computerId+"/exposures/"+g.id+"/connect"};
}
export async function issueExposure(account:string,computerId:string,spec:ExposureSpec,issuedKeyId?:string){
 const vm=await owned(computerId,account);
 if(!privateNetwork(vm))throw new ApiError(422,"Private guest network not configured");
 const instanceUid=await runningDisplay(computerId,account),token=randomBytes(32).toString("base64url");
 return database().transaction(async tx=>{
  const rows=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:network:"+account},0)) AS locked`);
  if(rows[0]?.locked!==true)throw new ApiError(409,"Exposure issuance busy");
  const now=new Date();
  const recent=await tx.select({id:networkGrants.id}).from(networkGrants).where(and(eq(networkGrants.account,account),gte(networkGrants.createdAt,new Date(now.getTime()-60000)))).limit(16);
  if(recent.length>=16)throw new ApiError(409,"Exposure issuance rate exceeded");
  await tx.delete(networkGrants).where(and(eq(networkGrants.account,account),lte(networkGrants.expiresAt,new Date(now.getTime()-60000))));
  const active=await tx.select().from(networkGrants).where(and(eq(networkGrants.account,account),gt(networkGrants.expiresAt,now),isNull(networkGrants.revokedAt)));
  if(active.length>=8||active.filter(g=>g.computerId===computerId).length>=4)throw new ApiError(409,"Exposure quota exceeded");
  const [g]=await tx.insert(networkGrants).values({id:randomUUID(),account,computerId,instanceUid,port:spec.port,tokenHash:hash(token),issuedKeyId:issuedKeyId??null,expiresAt:new Date(now.getTime()+spec.ttlSeconds*1000)}).returning();
  return {...publicGrant(g),token,authorizationScheme:"Network"};
 });
}
export async function lookupExposure(id:string,computerId:string,token:string){
 const [g]=await database().select().from(networkGrants).where(eq(networkGrants.tokenHash,hash(token)));
 if(!g||!validNetworkGrant(g,id,computerId))throw new ApiError(401,"Invalid or expired network grant");
 if(g.issuedKeyId){
  const [key]=await database().select().from(accountKeys).where(and(eq(accountKeys.id,g.issuedKeyId),eq(accountKeys.account,g.account)));
  if(!key||key.revokedAt||key.expiresAt.getTime()<=Date.now()||key.permission!=="manage")throw new ApiError(401,"Issuing account key is inactive");
 }
 const vm=await owned(computerId,g.account);
 if(!privateNetwork(vm)||await runningDisplay(computerId,g.account)!==g.instanceUid)throw new ApiError(409,"Network grant instance is no longer eligible");
 return g;
}
export async function listExposures(account:string,computerId:string){
 await owned(computerId,account);
 const rows=await database().select().from(networkGrants).where(and(eq(networkGrants.account,account),eq(networkGrants.computerId,computerId)));
 let uid:string|null=null;try{uid=await runningDisplay(computerId,account)}catch(e){if(!(e instanceof ApiError)||e.status!==409)throw e}
 return rows.map(g=>({...publicGrant(g),active:validNetworkGrant(g,g.id,computerId)&&g.instanceUid===uid}));
}
export async function revokeExposure(account:string,computerId:string,id:string){
 await owned(computerId,account);
 const where=and(eq(networkGrants.account,account),eq(networkGrants.computerId,computerId),eq(networkGrants.id,id));
 const [g]=await database().update(networkGrants).set({revokedAt:new Date()}).where(and(where,isNull(networkGrants.revokedAt))).returning();
 if(g)return publicGrant(g);
 const [old]=await database().select().from(networkGrants).where(where);
 if(!old)throw new ApiError(404,"Exposure not found");
 return publicGrant(old);
}
