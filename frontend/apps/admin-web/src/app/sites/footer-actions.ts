"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteFooterSettings} from "@uog/types";
import type {PublicMenuNode} from "@uog/ui";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";
export interface SiteFooterEnvelope {site:number;version:number;settings:SiteFooterSettings;menu_items:PublicMenuNode[];site_origin:string|null;branding:{name:string;theme:"institutional"|"high-contrast";logo_asset_id:string|null}}
async function request(site:number,settings?:SiteFooterSettings,etag?:string):Promise<ActionResult<{data:SiteFooterEnvelope;etag:string|null}>> {
 try {
  if(!Number.isSafeInteger(site)||site<1)throw new Error("Choose a Site.");
  const api=createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:(await getAccessToken())??undefined});
  const path=`/v1/sites/${site}/footer/`;
  const response=settings?await api.patchDetailed<SiteFooterEnvelope>(path,settings,{ifMatch:etag??""}):await api.getDetailed<SiteFooterEnvelope>(path);
  if(response.data.site!==site)throw new Error("Footer settings belong to another Site.");
  return {ok:true,data:{data:response.data,etag:response.etag}};
 }catch(cause){return {ok:false,error:serializeApiError(cause)};}
}
export async function getSiteFooter(site:number){return request(site);}
export async function updateSiteFooter(site:number,etag:string,settings:SiteFooterSettings){return request(site,settings,etag);}
