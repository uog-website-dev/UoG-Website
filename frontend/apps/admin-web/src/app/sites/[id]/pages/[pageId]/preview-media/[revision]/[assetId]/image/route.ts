import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/access-token";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store","Surrogate-Control":"no-store",Vary:"Cookie, Host, Authorization","X-Content-Type-Options":"nosniff"};
export async function GET(request:NextRequest,context:{params:Promise<{id:string;pageId:string;revision:string;assetId:string}>}) {
  const {id,pageId,revision,assetId}=await context.params;
  const variant=request.nextUrl.searchParams.get("variant") ?? "display";
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if(!/^[1-9][0-9]*$/.test(id)||!uuid.test(pageId)||!uuid.test(assetId)||!/^[1-9][0-9]*$/.test(revision)||!["display","thumbnail"].includes(variant))return new NextResponse(null,{status:404,headers});
  const token=await getAccessToken();
  if(!token)return new NextResponse(null,{status:401,headers});
  try {
    const upstream=await fetch(`${process.env.API_BASE_URL ?? "http://backend:8000/api"}/v1/sites/${id}/pages/${pageId}/preview/?revision=${revision}&asset_id=${assetId}&variant=${variant}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:request.signal});
    return new NextResponse(upstream.body,{status:upstream.status,headers:{...headers,"Content-Type":upstream.headers.get("content-type") ?? "application/json"}});
  } catch {return new NextResponse(null,{status:503,headers});}
}
