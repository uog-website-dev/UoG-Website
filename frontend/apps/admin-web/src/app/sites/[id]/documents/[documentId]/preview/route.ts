import {NextRequest,NextResponse} from "next/server";
import {getAccessToken} from "@/access-token";
export const runtime="nodejs";
export async function GET(request:NextRequest,context:{params:Promise<{id:string;documentId:string}>}){
 const {id,documentId}=await context.params;
 if(!/^[1-9][0-9]*$/.test(id)||!/^[0-9a-f-]{36}$/i.test(documentId))return new NextResponse(null,{status:404});
 const token=await getAccessToken();if(!token)return new NextResponse(null,{status:401});
 try{const upstream=await fetch(`${process.env.API_BASE_URL??"http://backend:8000/api"}/v1/sites/${id}/documents/${documentId}/preview/`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:request.signal});return new NextResponse(upstream.body,{status:upstream.status,headers:{"Content-Type":upstream.headers.get("content-type")??"application/json","Content-Disposition":upstream.headers.get("content-disposition")??"inline","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow",Vary:"Cookie, Host"}})}catch{return new NextResponse(null,{status:503,headers:{"Cache-Control":"no-store"}})}
}
