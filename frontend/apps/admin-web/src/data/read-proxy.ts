/** Server-only, fixed-destination read BFF. Django remains the authorization authority. */
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";

const resources: Record<string, {path: (site: number) => string; query: string[]}> = {
  pages: {path: site => `/v1/sites/${site}/pages/`, query:["search","status","author","visibility","locale","parent","ordering","page","page_size"]},
  "page-authors": {path: site => `/v1/sites/${site}/pages/authors/`, query:[]},
  posts: {path: site => `/v1/sites/${site}/posts/`, query:["search","status","locale","category","tag","author","ordering","page","page_size","created_after","created_before","published_after","published_before"]},
  "post-authors": {path: site => `/v1/sites/${site}/posts/authors/`, query:[]},
  media: {path: site => `/v1/sites/${site}/assets/`, query:["search","status","type","content_type","ready_images","ordering","page","page_size"]},
  menus: {path: site => `/v1/sites/${site}/menus/`, query:["search","is_active","page","page_size"]},
  inheritance: {path: site => `/v1/sites/${site}/menu-inheritance/`, query:[]},
  categories: {path: site => `/v1/sites/${site}/categories/`, query:["is_active","ordering","page","page_size"]},
  tags: {path: site => `/v1/sites/${site}/tags/`, query:["is_active","ordering","page","page_size"]},
  "dashboard-summary": {path: () => "/workspace/dashboard/", query:[]},
  "dashboard-activity": {path: () => "/workspace/dashboard/activity/", query:[]},
};
const privateHeaders = {"Cache-Control":"private, no-store", "Vary":"Cookie, Accept-Encoding", "X-Content-Type-Options":"nosniff"};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(status:number, code:string, requestId:string) {
  return Response.json({error:{code,message:code.replaceAll("_"," "),details:null,request_id:requestId}}, {status,headers:{...privateHeaders,"X-Request-ID":requestId}});
}

export async function readProxy(request:Request) {
  const started=performance.now();
  const supplied=request.headers.get("x-request-id");
  const requestId=supplied && UUID.test(supplied) ? supplied : crypto.randomUUID();
  const timeout=AbortSignal.timeout(10_000);
  if(request.method!=="GET") return failure(405,"method_not_allowed",requestId);
  const url=new URL(request.url), origin=request.headers.get("origin");
  if(request.headers.get("sec-fetch-site")==="cross-site" || (origin && origin!==url.origin)) return failure(403,"cross_origin_read_denied",requestId);
  const params=url.searchParams, resource=params.get("resource")??"", definition=resources[resource];
  const site=Number(params.get("site"));
  if(!Object.hasOwn(resources,resource) || !definition || url.search.length>2048 || !/^[1-9]\d*$/.test(params.get("site")??"") || !Number.isSafeInteger(site)
    || [...params.keys()].some(key => !["site","resource",...definition.query].includes(key) || params.getAll(key).length!==1)) return failure(400,"invalid_read_query",requestId);
  if(request.signal.aborted) return failure(499,"read_cancelled",requestId);
  let token:string|null;
  try {token=await getAccessToken();}
  catch {return failure(503,"session_unavailable",requestId);}
  if(!token) return failure(401,"unauthenticated",requestId);
  const upstreamQuery=new URLSearchParams(params); upstreamQuery.delete("resource");
  if(!resource.startsWith("dashboard-")) upstreamQuery.delete("site");
  try {
    const upstreamStarted=performance.now();
    // A caller may reuse a root correlation ID for several parallel reads.
    // Each Django request still needs its own ID; serverApiFetch links its parent.
    const upstreamId=crypto.randomUUID();
    const upstream=await serverApiFetch(`${process.env.API_BASE_URL??"http://backend:8000/api"}${definition.path(site)}?${upstreamQuery}`, {
      method:"GET", headers:{Accept:"application/json",Authorization:`Bearer ${token}`,"X-Request-ID":upstreamId},
      cache:"no-store", redirect:"error", signal:AbortSignal.any([request.signal,timeout]),
    });
    if(!(upstream.headers.get("content-type")??"").includes("application/json")) return failure(502,"invalid_upstream_response",requestId);
    const body=await upstream.json();
    const upstreamMs=performance.now()-upstreamStarted;
    const rows=resource==="inheritance" ? body : body?.results;
    if(upstream.ok && (resource.startsWith("dashboard-") ? body?.site!==site : !Array.isArray(rows) || rows.some((row:{site?:unknown})=>row?.site!==site))) return failure(502,"invalid_upstream_scope",requestId);
    const returnedId=upstream.headers.get("x-request-id");
    const headers:Record<string,string>={...privateHeaders,"X-Request-ID":returnedId && UUID.test(returnedId) ? returnedId : upstreamId};
    const encodeStarted=performance.now();
    const response=Response.json(body,{status:upstream.status,headers});
    const encodeMs=performance.now()-encodeStarted;
    if(process.env.PERF_INSTRUMENTATION_ENABLED==="1") {
      response.headers.set("Server-Timing",`bff;dur=${(performance.now()-started).toFixed(3)}, upstream;dur=${upstreamMs.toFixed(3)}, encode;dur=${encodeMs.toFixed(3)}`);
    }
    // Leave transfer encoding to Next/nginx. Manually compressing here causes
    // the route response to be encoded twice in the browser and breaks JSON
    // parsing for same-origin Admin reads (for example, the Media picker).
    return response;
  } catch {
    return failure(request.signal.aborted ? 499 : timeout.aborted ? 504 : 502, request.signal.aborted ? "read_cancelled" : timeout.aborted ? "read_timeout" : "upstream_unavailable",requestId);
  }
}
