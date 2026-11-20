/** Same-origin read transport. Never imports server authentication or holds tokens. */
import {ApiError, createApiClient} from "@uog/api-client";
import {APP_BASE_PATH} from "@/base-path";
import {deserializeApiError, serializeApiError, type ActionResult} from "@/organizations/contract";
import type {SitePageListQuery, SitePageListResponse, SitePageStatus} from "@/app/sites/page-actions";
import type {SitePostListQuery, SitePostListResponse, SiteTaxonomyRecord} from "@/app/sites/post-actions";
import type {SiteNavigation, MenuRecord, MenuInheritanceRecord} from "@/app/sites/menu-actions";
import type {MediaListQuery, PaginatedResponse} from "@uog/types";
import type {MediaAssetRecord} from "@/app/sites/media-actions";
import {validSummary, validActivity, type DashboardSummary, type DashboardActivity} from "./dashboard-contract";

async function read<T>(site:number, resource:string, query:object={}, signal?:AbortSignal):Promise<ActionResult<T>> {
  try {
    if(!Number.isSafeInteger(site)||site<1) throw new ApiError("A valid Site is required.",400);
    const params=new URLSearchParams({site:String(site),resource});
    for(const [key,value] of Object.entries(query)) if(value!==undefined && value!==null && value!=="") params.set(key,String(value));
    const client=createApiClient({baseUrl:`${APP_BASE_PATH}/api`,timeoutMs:12_000});
    const response=await client.getDetailed<T>(`/reads?${params}`,{signal,cache:"no-store",credentials:"same-origin"});
    return {ok:true,data:response.data,etag:response.etag};
  } catch(error) {
    // Abort must reach TanStack Query as cancellation, not a cached API failure.
    signal?.throwIfAborted();
    return {ok:false,error:serializeApiError(error)};
  }
}
export const loadSitePages=(site:number,query:SitePageListQuery={},signal?:AbortSignal)=>read<SitePageListResponse>(site,"pages",query,signal);
export const loadSitePosts=(site:number,query:SitePostListQuery={},signal?:AbortSignal)=>read<SitePostListResponse>(site,"posts",query,signal);
export interface SiteContentAuthor { id:number; name:string; site:number }
export interface SiteContentAuthorList { count:number; next:null; previous:null; results:SiteContentAuthor[] }
export const loadSitePageAuthors=(site:number,signal?:AbortSignal)=>read<SiteContentAuthorList>(site,"page-authors",{},signal);
export const loadSitePostAuthors=(site:number,signal?:AbortSignal)=>read<SiteContentAuthorList>(site,"post-authors",{},signal);
export const listSiteMedia=(site:number,query:MediaListQuery={},signal?:AbortSignal)=>read<PaginatedResponse<MediaAssetRecord>>(site,"media",query,signal);
async function collect<T>(site:number,resource:string,query:object,signal?:AbortSignal):Promise<T[]> {
  const rows:T[]=[];
  for(let page=1;page<=100;page++) {
    const result=await read<PaginatedResponse<T>>(site,resource,{...query,page,page_size:100},signal);
    if(!result.ok) throw deserializeApiError(result.error);
    rows.push(...result.data.results);
    if(!result.data.next) return rows;
  }
  throw new ApiError("The directory exceeds its response limit.",502);
}
export async function loadSiteTaxonomy(site:number,kind:"categories"|"tags",signal?:AbortSignal):Promise<ActionResult<SiteTaxonomyRecord[]>> {
  try {return {ok:true,data:await collect<SiteTaxonomyRecord>(site,kind,{is_active:true,ordering:"name"},signal)};}
  catch(error) {signal?.throwIfAborted();return {ok:false,error:serializeApiError(error)};}
}
/** Directory only; tree reads and mutations retain their ETag-aware action path. */
export async function loadSiteNavigation(site:number,includeItems:false=false,signal?:AbortSignal):Promise<ActionResult<SiteNavigation>> {
  try {
    const [menus,policy]=await Promise.all([collect<MenuRecord>(site,"menus",{},signal),read<MenuInheritanceRecord[]>(site,"inheritance",{},signal)]);
    if(!policy.ok) return policy;
    return {ok:true,data:{menus:menus.map(menu=>({menu,items:[],etag:`"menu-${menu.id}-v${menu.version??0}"`,itemsLoaded:false})),inheritance:policy.data}};
  } catch(error) {signal?.throwIfAborted();return {ok:false,error:serializeApiError(error)};}
}
export async function getSiteDashboardSummary(site:number,signal?:AbortSignal):Promise<ActionResult<DashboardSummary>> {
  const result=await read<DashboardSummary>(site,"dashboard-summary",{},signal);
  return result.ok && (result.data?.site!==site || !validSummary(result.data)) ? {ok:false,error:serializeApiError(new ApiError("Invalid dashboard response.",502))} : result;
}
export async function getSiteDashboardActivity(site:number,signal?:AbortSignal):Promise<ActionResult<DashboardActivity>> {
  const result=await read<DashboardActivity>(site,"dashboard-activity",{},signal);
  return result.ok && (result.data?.site!==site || !validActivity(result.data)) ? {ok:false,error:serializeApiError(new ApiError("Invalid activity response.",502))} : result;
}
export async function loadSitePageStatusCounts(site:number,signal?:AbortSignal):Promise<ActionResult<Record<SitePageStatus,number>>> {
  const result=await getSiteDashboardSummary(site,signal);
  if(!result.ok) return result;
  const section=result.data.sections.pages;
  if(!section || section.status!=="ready" || !section.counts) return {ok:false,error:serializeApiError(new ApiError("Page counts unavailable.",section?503:403))};
  const statuses:SitePageStatus[]=["DRAFT","IN_REVIEW","APPROVED","PUBLISHED","UNPUBLISHED","ARCHIVED"];
  return {ok:true,data:Object.fromEntries(statuses.map(status=>[status,section.counts![status]??0])) as Record<SitePageStatus,number>};
}
