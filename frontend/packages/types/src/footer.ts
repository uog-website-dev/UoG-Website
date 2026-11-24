/** Footer content is Site-owned; links come from its published Footer menu. */
export const FOOTER_SOCIAL_PLATFORMS=["x","youtube","facebook","linkedin","telegram","tiktok","instagram"] as const;
export type FooterSocialPlatform=typeof FOOTER_SOCIAL_PLATFORMS[number];
export interface FooterColumn {
 /** Site-owned menu that supplies the links; null keeps an empty column. */
 menu:string|null;
 /** Public heading, independent of the internal menu name. */
 heading:string;
 description:string;
}
export interface FooterLegalLink {label:string;url:string;}
export interface SiteFooterSettings {
 legal_links:FooterLegalLink[];
 newsletter_label:string;newsletter_url:string;support_label:string;support_url:string;
 description:string;address:string;email:string;phone:string;links_heading:string;
 highlight_label:string;highlight_url:string;copyright_text:string;
 social_links:{platform:FooterSocialPlatform;url:string}[];
 columns:FooterColumn[];
}
const COLUMN_MENU=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function defaultSiteFooter():SiteFooterSettings {
 return {legal_links:[],newsletter_label:"",newsletter_url:"",support_label:"",support_url:"",description:"",address:"",email:"",phone:"",links_heading:"Explore",highlight_label:"",highlight_url:"",copyright_text:"\u00a9 {year} {site}. All rights reserved.",social_links:[],columns:[]};
}
export function safeFooterUrl(value:unknown,httpsOnly=false):string|null {
 if(typeof value!=="string"||value.length>2048||!value||/[\u0000-\u0020\u007f\\]/.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)/i.test(value)||/%(?![0-9a-f]{2})/i.test(value))return null;
 try{const url=new URL(value);return (!url.username&&!url.password&&(httpsOnly?url.protocol==="https:":["https:","http:"].includes(url.protocol)))?value:null;}catch{return null;}
}
export function footerSettingsFrom(value:unknown):SiteFooterSettings {
 const result=defaultSiteFooter();if(!value||typeof value!=="object")return result;
 const row=value as Record<string,unknown>;
 for(const [key,max] of Object.entries({newsletter_label:120,newsletter_url:2048,support_label:120,support_url:2048,description:600,address:300,email:254,phone:48,links_heading:80,highlight_label:80,highlight_url:2048,copyright_text:300})){
  const content=row[key];if(typeof content==="string"&&content.length<=max)(result as unknown as Record<string,unknown>)[key]=content;
 }
 result.newsletter_url=safeFooterUrl(result.newsletter_url,true)??"";result.support_url=safeFooterUrl(result.support_url,true)??"";
 result.highlight_url=safeFooterUrl(result.highlight_url)??"";
 const seenLegal=new Set<string>();
 result.legal_links=Array.isArray(row.legal_links)?row.legal_links.slice(0,10).flatMap(item=>{
  if(!item||typeof item!=="object")return [];
  const link=item as {label?:unknown;url?:unknown};
  if(typeof link.label!=="string"||!link.label.trim()||link.label.length>80||typeof link.url!=="string")return [];
  const url=safeFooterUrl(link.url);if(!url||seenLegal.has(link.label))return [];
  seenLegal.add(link.label);return [{label:link.label.trim(),url}];
 }):[];
 const seen=new Set<string>();
 result.columns=Array.isArray(row.columns)?row.columns.slice(0,4).flatMap(item=>{
  if(!item||typeof item!=="object"||Array.isArray(item))return [];
  const column=item as {menu?:unknown;heading?:unknown;description?:unknown};
  if(typeof column.heading!=="string"||column.heading.length>80||typeof column.description!=="string"||column.description.length>300)return [];
  return [{menu:typeof column.menu==="string"&&COLUMN_MENU.test(column.menu)?column.menu:null,heading:column.heading,description:column.description}];
 }):[];
 result.social_links=Array.isArray(row.social_links)?row.social_links.slice(0,7).flatMap(item=>{
  if(!item||typeof item!=="object")return [];
  const link=item as {platform:FooterSocialPlatform;url:unknown};const url=safeFooterUrl(link.url,true);
  if(!FOOTER_SOCIAL_PLATFORMS.includes(link.platform)||seen.has(link.platform)||!url)return [];
  seen.add(link.platform);return [{platform:link.platform,url}];
 }):[];
 return result;
}
