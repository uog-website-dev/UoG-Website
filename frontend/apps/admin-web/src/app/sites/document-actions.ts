"use server";
import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface SiteDocumentRecord {id:string;site:number;title:string;slug:string;description:string;file_reference:string;file_type:string;categories:string[];status:string;visibility:string;version:string;effective_date:string|null;published_at:string|null;created_at:string;updated_at:string;revision_number:number}
export interface SiteDocumentList {count:number;next:string|null;previous:string|null;results:SiteDocumentRecord[]}
export interface SiteDocumentCategory {id:string;site:number;name:string;slug:string;is_active:boolean}
export interface SiteDocumentQuery {search?:string;category?:string;status?:string;file_type?:string;visibility?:string;page?:number;page_size?:number}
async function client(){return createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:(await getAccessToken())??undefined});}
async function run<T>(fn:()=>Promise<T>):Promise<ActionResult<T>>{try{return {ok:true,data:await fn()}}catch(e){return {ok:false,error:serializeApiError(e)}}}
const path=(site:number,id="")=>`/v1/sites/${site}/documents/${id}`;
const categoryPath=(site:number,id="")=>`/v1/sites/${site}/document-categories/${id}`;
export async function listSiteDocuments(site:number,query:SiteDocumentQuery={}):Promise<ActionResult<SiteDocumentList>>{return run(async()=>{const params=new URLSearchParams();for(const[k,v]of Object.entries(query))if(v)params.set(k,String(v));const r=await(await client()).get<SiteDocumentList>(path(site)+(params.size?`?${params}`:""));return {...r,results:r.results.filter(x=>x.site===site)}})}
export async function getSiteDocument(site:number,id:string):Promise<ActionResult<SiteDocumentRecord>>{return run(async()=>await(await client()).get<SiteDocumentRecord>(path(site,id+"/")))}
export async function saveSiteDocument(site:number,input:Partial<SiteDocumentRecord>&{title:string;slug:string;file_reference:string},id?:string):Promise<ActionResult<SiteDocumentRecord>>{return run(async()=>{const api=await client();return id?api.patch<SiteDocumentRecord>(path(site,id+"/"),input):api.post<SiteDocumentRecord>(path(site),input)})}
export async function manageSiteDocument(site:number,id:string,action:"publish"|"unpublish"|"delete"):Promise<ActionResult<void>>{return run(async()=>{const api=await client();if(action==="delete"){await api.delete(path(site,id+"/"));return}await api.post(path(site,`${id}/${action}/`),{});})}
export async function listSiteDocumentCategories(site:number):Promise<ActionResult<SiteDocumentCategory[]>>{return run(async()=>{const listed=await(await client()).get<{results:SiteDocumentCategory[]}>(categoryPath(site));return listed.results.filter(row=>row.site===site&&row.is_active)})}
export async function createSiteDocumentCategory(site:number,name:string):Promise<ActionResult<SiteDocumentCategory>>{return run(async()=>await(await client()).post(categoryPath(site),{name}))}
