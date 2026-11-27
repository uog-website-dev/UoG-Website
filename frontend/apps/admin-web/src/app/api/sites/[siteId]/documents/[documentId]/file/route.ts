import {NextRequest,NextResponse} from "next/server";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";

function unavailable(status:number,detail="Document file unavailable."){
 const response=NextResponse.json({detail},{status});response.headers.set("Cache-Control","private, no-store, max-age=0");response.headers.set("X-Content-Type-Options","nosniff");return response;
}

export async function GET(request:NextRequest,{params}:{params:Promise<{siteId:string;documentId:string}>}){
 const {siteId,documentId}=await params;const site=Number(siteId);if(!Number.isSafeInteger(site)||site<1)return unavailable(404,"Document unavailable.");
 const token=await getAccessToken();if(!token)return unavailable(401,"Authentication required.");
 const base=process.env.API_BASE_URL??"http://backend:8000/api";
 const inline=request.nextUrl.searchParams.get("inline")==="1"?"?inline=1":"";
 try{const file=await serverApiFetch(`${base}/v1/sites/${site}/documents/${encodeURIComponent(documentId)}/file/${inline}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/octet-stream"},cache:"no-store",redirect:"manual"});const headers=new Headers({"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; sandbox","X-Frame-Options":"SAMEORIGIN","Cross-Origin-Resource-Policy":"same-origin","Content-Disposition":file.headers.get("content-disposition")??"attachment"});const type=file.headers.get("content-type");if(type)headers.set("Content-Type",type);if(!file.ok)return unavailable(file.status);return new Response(file.body,{status:200,headers})}catch{return unavailable(502)}
}
