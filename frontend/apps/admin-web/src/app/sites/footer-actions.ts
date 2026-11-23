"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteFooterSettings} from "@uog/types";
import type {PublicMenuNode} from "@uog/ui";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface FooterEditorColumn {menu:string|null;menu_name:string|null;heading:string;description:string}
export interface LintWarning {path:string;message:string}
export interface SiteFooterEnvelope {
 site:number;version:number;settings:SiteFooterSettings;published_settings:SiteFooterSettings;
 has_unpublished_changes:boolean;published_at:string|null;previous_available:boolean;
 columns:FooterEditorColumn[];menu_items:PublicMenuNode[];site_origin:string|null;
 branding:{name:string;theme:"institutional"|"high-contrast";logo_asset_id:string|null};
 lint_warnings?:LintWarning[];
}
type Action = "settings" | "publish" | "restore";
async function request(site:number,{action,settings,etag}:{action:Action;settings?:SiteFooterSettings;etag?:string}):Promise<ActionResult<{data:SiteFooterEnvelope;etag:string|null}>> {
 try {
  if(!Number.isSafeInteger(site)||site<1)throw new Error("Choose a Site.");
  const api=createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:(await getAccessToken())??undefined});
  const base=`/v1/sites/${site}/footer/`;
  const response=action==="settings"
   ? (settings?await api.patchDetailed<SiteFooterEnvelope>(base,settings,{ifMatch:etag??""}):await api.getDetailed<SiteFooterEnvelope>(base))
   : await api.postDetailed<SiteFooterEnvelope>(`${base}${action==="publish"?"publish":"restore-previous"}/`,{},{headers:{"If-Match":etag??""}});
  if(response.data.site!==site)throw new Error("Footer settings belong to another Site.");
  return {ok:true,data:{data:response.data,etag:response.etag}};
 }catch(cause){return {ok:false,error:serializeApiError(cause)};}
}
export async function getSiteFooter(site:number){return request(site,{action:"settings"});}
export async function updateSiteFooter(site:number,etag:string,settings:SiteFooterSettings){return request(site,{action:"settings",settings,etag});}
export async function publishSiteFooter(site:number,etag:string){return request(site,{action:"publish",etag});}
export async function restorePreviousSiteFooter(site:number,etag:string){return request(site,{action:"restore",etag});}
