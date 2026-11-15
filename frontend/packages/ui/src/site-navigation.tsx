"use client";

/** Shared host-scoped navigation for public output and authenticated previews. */
import {useEffect,useId,useState} from "react";
import type {ReactNode} from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";

export interface PublicMenuNode {label:string;href:string;children?:PublicMenuNode[];unavailable?:boolean;}
const SAFE_PATH=/^\/(?!\/)(?!\\)[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#]*$/;

export function safeMenuHref(value:string):string|null {
 if(typeof value!=="string")return null;
 const href=value.trim();
 if(!href||/[\u0000-\u0020\u007f\\]/.test(href)||/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)/i.test(href)||/%(?![0-9a-f]{2})/i.test(href))return null;
 if(/^#[a-z][a-z0-9-]{0,63}$/.test(href))return href;
 if(href.startsWith("/"))return SAFE_PATH.test(href)?href:null;
 try {const url=new URL(href);return !url.username&&!url.password&&["http:","https:"].includes(url.protocol)?url.toString():null;}catch{return null;}
}

export function menusFromResponse(status:number,body:unknown):{header:PublicMenuNode[];footer:PublicMenuNode[];utility?:PublicMenuNode[]} {
 if(status<200||status>=300||!body||typeof body!=="object")return {header:[],footer:[]};
 const locations=(body as {locations?:unknown}).locations;
 const record=locations&&typeof locations==="object"?locations as Record<string,unknown>:{};
 return {...(Array.isArray(record.secondary)?{utility:normalizeNodes(record.secondary)}:{}),header:normalizeNodes(record.header),footer:normalizeNodes(record.footer)};
}
function normalizeNodes(value:unknown,depth=1,budget={remaining:1000}):PublicMenuNode[] {
 if(!Array.isArray(value)||depth>4)return [];
 const nodes:PublicMenuNode[]=[];
 for(const entry of value){
  if(budget.remaining--<=0)break;
  if(!entry||typeof entry!=="object")continue;
  const row=entry as {label?:unknown;href?:unknown;children?:unknown;destination_status?:unknown};
  if(typeof row.label!=="string"||!row.label.trim())continue;
  nodes.push({label:row.label.trim(),href:typeof row.href==="string"?safeMenuHref(row.href)??"":"",children:normalizeNodes(row.children,depth+1,budget),...(row.destination_status==="unavailable"?{unavailable:true}:{})});
 }
 return nodes;
}

interface LinkContext {currentPath:string;siteOrigin?:string;openLinksInNewTab?:boolean;onNavigate?:()=>void;}
function destination(value:string,origin?:string,path="/"):string|null {
 const safe=safeMenuHref(value);if(!safe)return null;
 if(origin&&(safe.startsWith("/")||safe.startsWith("#"))){try{return new URL(safe,new URL(path||"/",origin)).toString();}catch{return null;}}
 return safe;
}
function current(href:string,path:string,origin?:string):boolean {
 if(!path)return false;
 try {
  const base=origin??(typeof window!=="undefined"?window.location.origin:"https://invalid.local");
  const page=new URL(path,base),link=new URL(href,page);
  const clean=(value:string)=>value.replace(/\/+$/,"")||"/";
  return link.origin===page.origin&&clean(link.pathname)===clean(page.pathname)&&(!link.search||link.search===page.search)&&(!link.hash||link.hash===page.hash);
 }catch{return false;}
}
function NavigationLink({item,context,children}:{item:PublicMenuNode;context:LinkContext;children?:ReactNode}){
 const href=item.unavailable?null:destination(item.href,context.siteOrigin,context.currentPath);
 if(!href)return <Box component="span" aria-disabled={item.unavailable||undefined} sx={{overflowWrap:"anywhere"}}>{children??item.label}{item.unavailable?" (unavailable)":""}</Box>;
 const active=current(href,context.currentPath,context.siteOrigin);
 return <Link href={href} aria-current={active?"page":undefined} target={context.openLinksInNewTab?"_blank":undefined} rel={context.openLinksInNewTab?"noopener noreferrer":undefined} onClick={()=>context.onNavigate?.()} color="inherit" underline={active?"always":"hover"} sx={{display:"inline-flex",alignItems:"center",minHeight:44,maxWidth:"100%",overflowWrap:"anywhere",fontWeight:active?700:undefined,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2,borderRadius:0.5}}}>{children??item.label}</Link>;
}
function MenuLinks({items,context,depth=0}:{items:PublicMenuNode[];context:LinkContext;depth?:number}){
 if(depth>=4)return null;
 return <Box component="ul" sx={{listStyle:"none",m:0,p:0,pl:depth?2:0,minWidth:0}}>
  {items.slice(0,1000).map((item,index)=><Box component="li" key={`${index}-${item.href}`} sx={{py:0.25,minWidth:0,overflowWrap:"anywhere"}}>
   <NavigationLink item={item} context={context}/>
   {item.children?.length?<MenuLinks items={item.children} context={context} depth={depth+1}/>:null}
  </Box>)}
 </Box>;
}
export function SiteNavigation({items,label,mobile=false,dropdown=false,currentPath,siteOrigin,openLinksInNewTab=false}:{items:PublicMenuNode[];label:string;mobile?:boolean;dropdown?:boolean;currentPath?:string;siteOrigin?:string;openLinksInNewTab?:boolean}){
 const [open,setOpen]=useState(false),[browserPath,setBrowserPath]=useState("");
 const menuId=useId();
 useEffect(()=>{const update=()=>setBrowserPath(window.location.pathname+window.location.search+window.location.hash);update();window.addEventListener("popstate",update);window.addEventListener("hashchange",update);return()=>{window.removeEventListener("popstate",update);window.removeEventListener("hashchange",update);};},[]);
 useEffect(()=>{setOpen(false);},[items,currentPath]);
 const context:LinkContext={currentPath:currentPath??browserPath,siteOrigin,openLinksInNewTab};
 if(!items.length)return null;
 if(dropdown)return <Box component="nav" aria-label={label} sx={{minWidth:0,overflowWrap:"anywhere"}}>
  <Box component="ul" sx={{display:"flex",flexWrap:"wrap",gap:1,listStyle:"none",m:0,p:0}}>
   {items.map((item,index)=><Box component="li" key={`${index}-${item.label}`} sx={{position:"relative",minWidth:0,maxWidth:"100%"}}>
    {item.children?.length?<Box component="details" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();const details=event.currentTarget as HTMLDetailsElement;details.open=false;details.querySelector('summary')?.focus();}}} sx={{"& > summary":{cursor:"pointer",minHeight:44,p:1,fontWeight:600,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}}>
     <Box component="summary">{item.label}</Box>
     <Box sx={{bgcolor:"background.paper",color:"text.primary",boxShadow:4,borderRadius:2,p:2,maxWidth:"100%",zIndex:4,"@container visual-layout (min-width: 768px)":{position:"absolute",minWidth:240}}}>
      <NavigationLink item={item} context={context}>Overview</NavigationLink><MenuLinks items={item.children} context={context} depth={1}/>
     </Box>
    </Box>:<NavigationLink item={item} context={context}/>}
   </Box>)}
  </Box>
 </Box>;
 return <Box component="nav" aria-label={label} sx={{px:2,py:mobile?1:0.5,minWidth:0,maxWidth:"100%"}}>
  {mobile?<>
   <Box sx={{display:{xs:"none",md:"block"}}}><MenuLinks items={items} context={context}/></Box>
   <IconButton aria-label={`Open ${label.toLowerCase()}`} aria-expanded={open} aria-controls={menuId} onClick={()=>setOpen(true)} sx={{display:{xs:"inline-flex",md:"none"},"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}><MenuIcon/></IconButton>
   <Drawer anchor="left" open={open} onClose={()=>setOpen(false)}><Box sx={{width:280,maxWidth:"100vw",boxSizing:"border-box",p:2}} id={menuId}>
    <IconButton aria-label={`Close ${label.toLowerCase()}`} onClick={()=>setOpen(false)} sx={{"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}><CloseIcon/></IconButton>
    <Box component="div" role="navigation" aria-label={label}><MenuLinks items={items} context={{...context,onNavigate:()=>setOpen(false)}}/></Box>
   </Box></Drawer>
  </>:<MenuLinks items={items} context={context}/>}
 </Box>;
}
export function PublicMenuFrame({utility=[],header,footer,children,...context}:{header:PublicMenuNode[];footer:PublicMenuNode[];utility?:PublicMenuNode[];children:ReactNode;currentPath?:string;siteOrigin?:string;openLinksInNewTab?:boolean}){
 return <><SiteNavigation items={utility} label="Site utility" mobile {...context}/><SiteNavigation items={header} label="Site header" mobile {...context}/>{children}<SiteNavigation items={footer} label="Site footer" {...context}/></>;
}
