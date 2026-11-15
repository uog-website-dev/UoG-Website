"use server";

import {serverApiFetch} from "@/performance/server-fetch";
import {createApiClient} from "@uog/api-client";
import {validateVisualLayout} from "@uog/types";
import type {VisualLayout} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";
export interface HomepageTemplate {
 manifest_version:number;id:string;version:number;name:string;description:string;
 required_modules:string[];layout:VisualLayout|null;available:boolean;unavailable_reasons:string[];
}
async function client(){return createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:(await getAccessToken())??undefined});}
export async function loadHomepageTemplates(siteId:number):Promise<ActionResult<HomepageTemplate[]>>{
 try{const api=await client();const data=await api.get<HomepageTemplate[]>(`/v1/sites/${siteId}/homepage-templates/`);
 return {ok:true,data:data.map(entry=>({...entry,available:entry.available && entry.manifest_version===1 && !!entry.layout && validateVisualLayout(entry.layout).ok,unavailable_reasons:entry.manifest_version===1?entry.unavailable_reasons:["Unsupported template manifest version."]}))};
 }catch(error){return {ok:false,error:serializeApiError(error)};}
}
export async function prepareHomepageTemplate(siteId:number,templateId:string,version:number):Promise<ActionResult<VisualLayout>>{
 try{const api=await client();const result=await api.post<{visual_layout:VisualLayout}>(`/v1/sites/${siteId}/homepage-templates/prepare/`,{template_id:templateId,version});
 const checked=validateVisualLayout(result.visual_layout);if(!checked.ok)throw new Error("The template document is incompatible with this builder.");
 return {ok:true,data:checked.value};}catch(error){return {ok:false,error:serializeApiError(error)};}
}
