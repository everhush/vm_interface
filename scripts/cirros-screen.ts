/** Exact documented CirrOS console interleave, not a general fuzzy matcher.
 * Only the complete timestamped kernel entropy message is removed. Retain
 * all other characters (including forbidden controller input) for assertions.
 */
const entropy=/(?:(?:\[|l|i|£)\s*\d{1,6}\.\d{6}\]|f\s*\d{1,6}\.\d{6}1)\s*random:\s*nonblocking\s+pool\s+is\s+initial\s*i?\s*zed/gi;
export function cirrosNormalize(text:string){
 return text.replace(entropy,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}
export function cirrosReady(text:string,elapsedMs:number){
 // No mandatory entropy message: the kernel may not display it at all.
 // The bounded grace period avoids expected late console output when absent.
 return cirrosNormalize(text).includes("cirroslogin")&&
  (/\bnonblocking\s+pool\s+is\s+initial\s*i?\s*zed/i.test(text)||elapsedMs>=180000);
}
