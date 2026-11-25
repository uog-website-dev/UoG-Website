import {NextRequest,NextResponse} from "next/server";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";

export async function GET(request:NextRequest,{params}:{params:Promise<{siteId:string;documentId:string}>}){
 const {siteId,documentId}=await params;const site=Number(siteId);if(!Number.isSafeInteger(site)||site<1)return NextResponse.json({detail:"Document unavailable."},{status:404});
 const token=await getAccessToken();if(!token)return NextResponse.json({detail:"Authentication required."},{status:401});
 const base=process.env.API_BASE_URL??"http://backend:8000/api";
 try{const api=await serverApiFetch(`${base}/v1/sites/${site}/documents/${documentId}/`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});if(!api.ok)return NextResponse.json({detail:"Document unavailable."},{status:api.status===404?404:403});const document=await api.json() as {site?:number;file_reference?:string};if(document.site!==site||!document.file_reference?.startsWith(`sites/${site}/assets/`))return NextResponse.json({detail:"Document unavailable."},{status:404});const assetId=document.file_reference.split("/").pop();const inline=request.nextUrl.searchParams.get("inline")==="1"?"?inline=1":"";const file=await serverApiFetch(`${base}/v1/sites/${site}/assets/${assetId}/download/${inline}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});if(!file.ok)return NextResponse.json({detail:"Document file unavailable."},{status:file.status});const headers=new Headers({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":file.headers.get("content-disposition")??"attachment"});const type=file.headers.get("content-type");if(type)headers.set("Content-Type",type);return new Response(file.body,{status:200,headers})}catch{return NextResponse.json({detail:"Document file unavailable."},{status:502})}
}
