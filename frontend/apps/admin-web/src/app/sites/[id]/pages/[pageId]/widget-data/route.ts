import {NextRequest,NextResponse} from "next/server";
import {getAccessToken} from "@/access-token";

const headers={"Cache-Control":"private, no-store","Surrogate-Control":"no-store",Vary:"Cookie, Host, Authorization"};

export async function GET(request:NextRequest,context:{params:Promise<{id:string;pageId:string}>}) {
  const {id,pageId}=await context.params;
  if(!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pageId)){
    return new NextResponse(null,{status:404,headers});
  }
  const token=await getAccessToken();
  if(!token)return new NextResponse(null,{status:401,headers});
  try{
    const base=process.env.API_BASE_URL??"http://backend:8000/api";
    const upstream=await fetch(`${base}/v1/sites/${id}/pages/${pageId}/widget-data/?${request.nextUrl.searchParams}`,{
      headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:request.signal});
    return new NextResponse(upstream.body,{status:upstream.status,headers:{...headers,"Content-Type":"application/json"}});
  }catch{return new NextResponse(null,{status:503,headers});}
}
