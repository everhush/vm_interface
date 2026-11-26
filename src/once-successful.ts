/** Single-flight initialization: only successful completion is cached.
 * A failure clears the flight so the next readiness probe can retry.
 * This is not a cached health check; callers must check live dependencies. */
export function onceSuccessful(initialize:()=>Promise<void>){
 let flight:Promise<void>|undefined;
 return ()=>{
  if(!flight)flight=Promise.resolve().then(initialize).catch(e=>{flight=undefined;throw e});
  return flight;
 };
}
