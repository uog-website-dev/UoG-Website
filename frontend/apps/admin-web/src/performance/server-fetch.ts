/** Request-scoped tracing for server actions, RSC reads and workspace fan-out. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function traceIdentifier(value:string|null):string|null{return value && UUID.test(value)?value:null;}
export const serverApiFetch:typeof fetch=async(input,init)=>{
 if(process.env.PERF_INSTRUMENTATION_ENABLED!=="1")return fetch(input,init);
 const {headers:requestHeaders}=await import("next/headers");
 let incoming:Headers|null=null;
 try{incoming=new Headers(await requestHeaders());}catch{/* Build-time or standalone call: no request context. */}
 const navigation=traceIdentifier(incoming?.get("x-navigation-id")??null);
 const parent=traceIdentifier(incoming?.get("x-request-id")??null);
 const headers=new Headers(input instanceof Request?input.headers:undefined);
 new Headers(init?.headers).forEach((v,k)=>headers.set(k,v));
 if(!traceIdentifier(headers.get("x-request-id")))headers.set("x-request-id",crypto.randomUUID());
 if(navigation)headers.set("x-navigation-id",navigation);
 if(parent)headers.set("x-parent-request-id",parent);
 const started=performance.now();
 // Never log URLs, headers, payloads, tokens, SQL or error messages.
 try{
  const response=await fetch(input,{...init,headers});
  console.info(JSON.stringify({event:"uog.next.upstream",navigation_id:navigation,parent_request_id:parent,
   request_id:traceIdentifier(response.headers.get("x-request-id")),method:init?.method??(input instanceof Request?input.method:"GET"),status:response.status,
   duration_ms:Math.round((performance.now()-started)*1000)/1000,
   sql_count:Number(response.headers.get("x-sql-count"))||0,sql_ms:Number(response.headers.get("x-sql-time-ms"))||0}));
  return response;
 }catch(error){console.info(JSON.stringify({event:"uog.next.upstream",navigation_id:navigation,parent_request_id:parent,request_id:headers.get("x-request-id"),status:0,duration_ms:performance.now()-started}));throw error;}
};
