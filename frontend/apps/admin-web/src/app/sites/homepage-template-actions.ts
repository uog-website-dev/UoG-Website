"use server";

import {serverApiFetch} from "@/performance/server-fetch";
import {createApiClient} from "@uog/api-client";
import {validateVisualLayout} from "@uog/types";
import type {VisualLayout} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";
import {invalidated} from "@/data/mutation-receipt";
import type {SitePageRecord} from "./page-actions";
export interface HomepageTemplate {
 manifest_version:number;id:string;version:number;name:string;description:string;
 media_slots?:{code:string;label:string;node_ids:string[]}[];
 required_modules:string[];layout:VisualLayout|null;available:boolean;unavailable_reasons:string[];
}
async function client(){return createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:(await getAccessToken())??undefined});}
export async function loadHomepageTemplates(siteId:number):Promise<ActionResult<HomepageTemplate[]>>{
 try{const api=await client();const data=await api.get<HomepageTemplate[]>(`/v1/sites/${siteId}/homepage-templates/`);
 return {ok:true,data:data.map(entry=>({...entry,available:entry.available && entry.manifest_version===1 && !!entry.layout && validateVisualLayout(entry.layout).ok,unavailable_reasons:entry.manifest_version===1?entry.unavailable_reasons:["Unsupported template manifest version."]}))};
 }catch(error){return {ok:false,error:serializeApiError(error)};}
}
export async function prepareHomepageTemplate(siteId:number,templateId:string,version:number,assets:Record<string,{asset_id:string;alt:string}>={}):Promise<ActionResult<VisualLayout>>{
 try{const api=await client();const result=await api.post<{visual_layout:VisualLayout}>(`/v1/sites/${siteId}/homepage-templates/prepare/`,{template_id:templateId,version,assets});
 const checked=validateVisualLayout(result.visual_layout);if(!checked.ok)throw new Error("The template document is incompatible with this builder.");
 return {ok:true,data:checked.value};}catch(error){return {ok:false,error:serializeApiError(error)};}
}
export async function applyHomepageTemplate(siteId:number,input:{assets?:Record<string,{asset_id:string;alt:string}>;template_id:string;version:number;mode:"new"|"replace";title?:string;page_id?:string},idempotencyKey:string,ifMatch?:string):Promise<ActionResult<SitePageRecord>>{
 return invalidated(siteId,"pages",(async()=>{try{const api=await client();const result=await api.postDetailed<SitePageRecord>(`/v1/sites/${siteId}/homepage-templates/apply/`,input,{headers:{...(input.mode==="new"?{"Idempotency-Key":idempotencyKey}:{}),...(ifMatch?{"If-Match":ifMatch}:{})}});return {ok:true,data:{...result.data,etag:result.etag??""}};}catch(error){return {ok:false,error:serializeApiError(error)};}})());
}
