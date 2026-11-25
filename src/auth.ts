import {createHash,timingSafeEqual} from "node:crypto";
const digest=(s:string)=>createHash("sha256").update(s).digest();
export function accountFor(authorization:string|null, identities=process.env.TEST_IDENTITIES):string|null{
 if(!identities || !authorization?.startsWith("Bearer "))return null;
 const token=authorization.slice(7);
 if(token.length<32 || token.length>512)return null;
 const entries:unknown=JSON.parse(identities);
 if(!entries || typeof entries!=="object" || Array.isArray(entries))throw Error("Invalid test identity configuration");
 for(const [account,secret] of Object.entries(entries)){
  if(typeof secret!=="string" || secret.length<32 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(account) || account.length>63)throw Error("Invalid test identity configuration");
  if(timingSafeEqual(digest(token),digest(secret)))return account;
 }
 return null;
}
