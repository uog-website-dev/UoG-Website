"use server";
import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serializeApiError} from "@/organizations/contract";
import {serverApiFetch} from "@/performance/server-fetch";
import type {ActionResult} from "@/organizations/contract";

export type SiteDocumentStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
export interface SiteDocument {id:string;site:number;title:string;slug:string;description:string;file_reference:string;file_type:string;original_filename:string;file_size:number;categories:string[];categories_detail?:{id:string;name:string;slug:string}[];status:SiteDocumentStatus;creator:number|null;created_at:string;updated_at:string;revision_number:number;published_at:string|null;version:string;effective_date:string|null;visibility:"PUBLIC"|"UNLISTED"|"HIDDEN"}
export interface DocumentQuery {search?:string;category?:string;status?:SiteDocumentStatus;file_type?:string;visibility?:string;page?:number;page_size?:number}
export interface DocumentPage {count:number;next:string|null;previous:string|null;results:SiteDocument[]}
export interface DocumentCategory {id:string;name:string;slug:string}
const path=(site:number,id?:string)=>`/v1/sites/${site}/documents/${id?`${id}/`:""}`;
async function call<T>(fn:()=>Promise<T>):Promise<ActionResult<T>>{try{return{ok:true,data:await fn()}}catch(error){return{ok:false,error:serializeApiError(error)}}}
async function api(){const token=await getAccessToken();return createApiClient({fetchFn:serverApiFetch,baseUrl:process.env.API_BASE_URL??"http://backend:8000/api",accessToken:token??undefined})}
export async function listSiteDocuments(site:number,query:DocumentQuery={}):Promise<ActionResult<DocumentPage>>{return call(async()=>{const params=new URLSearchParams();Object.entries(query).forEach(([k,v])=>{if(v!==undefined&&v!=="")params.set(k,String(v))});const result=await(await api()).get<DocumentPage>(`${path(site)}?${params}`);return {...result,results:result.results.filter(row=>row.site===site)}})}
export async function getSiteDocument(site:number,id:string):Promise<ActionResult<SiteDocument>>{return call(async()=>{const row=await(await api()).get<SiteDocument>(path(site,id));if(row.site!==site)throw new Error("This document does not belong to the selected Site.");return row})}
export async function getSiteDocumentCategories(site:number):Promise<ActionResult<DocumentCategory[]>>{return call(async()=>await(await api()).get<DocumentCategory[]>(`/v1/sites/${site}/documents/categories/`))}
export async function createSiteDocumentCategory(site:number,name:string):Promise<ActionResult<DocumentCategory>>{return call(async()=>await(await api()).post<DocumentCategory>(`/v1/sites/${site}/documents/categories/`,{name}))}
export async function saveSiteDocument(site:number,input:Partial<SiteDocument>,id?:string):Promise<ActionResult<SiteDocument>>{return call(async()=>id?await(await api()).patch<SiteDocument>(path(site,id),input):await(await api()).post<SiteDocument>(path(site),input))}
export async function documentWorkflow(site:number,id:string,action:"publish"|"unpublish"):Promise<ActionResult<SiteDocument>>{return call(async()=>await(await api()).post<SiteDocument>(`${path(site,id)}${action}/`,{}))}
export async function deleteSiteDocument(site:number,id:string):Promise<ActionResult<null>>{return call(async()=>{await(await api()).delete(path(site,id));return null})}
