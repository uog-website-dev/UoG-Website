"use client";
import {MAX_MENU_DEPTH} from "@uog/types";

/** Shared host-scoped navigation for public output and authenticated previews. */
import {useEffect,useId,useRef,useState} from "react";
import type {ReactNode} from "react";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";

export interface PublicMenuNode {label:string;href:string;children?:PublicMenuNode[];unavailable?:boolean;column?:boolean;description?:string;menu?:string;}
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
 if(!Array.isArray(value)||depth>MAX_MENU_DEPTH)return [];
 const nodes:PublicMenuNode[]=[];
 for(const entry of value){
  if(budget.remaining--<=0)break;
  if(!entry||typeof entry!=="object")continue;
  const row=entry as {label?:unknown;href?:unknown;children?:unknown;destination_status?:unknown;column?:unknown;description?:unknown;menu?:unknown};
  if(typeof row.label!=="string"||!row.label.trim())continue;
  nodes.push({label:row.label.trim(),href:typeof row.href==="string"?safeMenuHref(row.href)??"":"",children:normalizeNodes(row.children,depth+(row.column===true&&depth===1?0:1),budget),...(row.column===true&&depth===1?{column:true,description:typeof row.description==="string"?row.description:"",...(typeof row.menu==="string"?{menu:row.menu}:{})}:{}),...(row.destination_status==="unavailable"?{unavailable:true}:{})});
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
function NavigationLink({item,context,children,rootTrigger=false,rootIndex}:{item:PublicMenuNode;context:LinkContext;children?:ReactNode;rootTrigger?:boolean;rootIndex?:number}){
 const href=item.unavailable?null:destination(item.href,context.siteOrigin,context.currentPath);
 if(!href)return <Box component="span" aria-disabled={item.unavailable||undefined} sx={{overflowWrap:"anywhere"}}>{children??item.label}{item.unavailable?" (unavailable)":""}</Box>;
 const active=current(href,context.currentPath,context.siteOrigin);
 return <Link data-nav-index={rootIndex} data-nav-trigger={rootTrigger||undefined} href={href} aria-current={active?"page":undefined} target={context.openLinksInNewTab?"_blank":undefined} rel={context.openLinksInNewTab?"noopener noreferrer":undefined} onClick={()=>context.onNavigate?.()} color="inherit" underline="none" sx={{display:"inline-flex",alignItems:"center",minHeight:44,maxWidth:"100%",overflowWrap:"anywhere",fontWeight:active?700:600,px:0.75,borderBottom:"2px solid",borderColor:active?"currentColor":"transparent","&:hover":{borderColor:"currentColor"},"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2,borderRadius:0.5}}}>{children??item.label}</Link>;
}
function MenuBranch({item,context,depth,collapsible}:{item:PublicMenuNode;context:LinkContext;depth:number;collapsible:boolean}) {
 const [expanded,setExpanded]=useState(false);
 const id=useId();
 const toggle=useRef<HTMLButtonElement|null>(null);
 const subtree=useRef<HTMLElement|null>(null);
 const children=Boolean(item.children?.length)&&depth<MAX_MENU_DEPTH-1;
 return <Box component="li" sx={{minWidth:0,overflowWrap:"anywhere"}}
  onKeyDown={event=>{if(!collapsible||!children)return;
   if(event.key==="Escape"&&expanded){event.preventDefault();event.stopPropagation();setExpanded(false);toggle.current?.focus();}
   if(event.key==="ArrowLeft"&&expanded){event.preventDefault();event.stopPropagation();setExpanded(false);toggle.current?.focus();}
  }}>
  <Box sx={{display:"flex",alignItems:"center",gap:.5,minWidth:0}}>
   <Box sx={{flex:1,minWidth:0}}><NavigationLink item={item} context={context}/></Box>
   {children&&collapsible?<IconButton ref={toggle} size="small" aria-label={`${expanded?"Hide":"Show"} ${item.label} submenu`} aria-expanded={expanded} aria-controls={expanded?id:undefined}
    onClick={()=>setExpanded(!expanded)} onKeyDown={event=>{if(event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();setExpanded(true);requestAnimationFrame(()=>subtree.current?.querySelector<HTMLElement>("a[href],button")?.focus());}}}
    sx={{width:36,height:44,flexShrink:0,color:"primary.main",borderRadius:1,"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:-3}}}>
    <ChevronRightRoundedIcon sx={{fontSize:19,transform:expanded?"rotate(90deg)":"none",transition:"transform 150ms ease","@media (prefers-reduced-motion:reduce)":{transition:"none"}}}/>
   </IconButton>:null}
  </Box>
  {children&&(!collapsible||expanded)?<Box ref={subtree} id={id} sx={collapsible?{ml:1.25,pl:1.5,mb:1,borderLeft:2,borderColor:"divider"}:undefined}>
   <MenuLinks items={item.children??[]} context={context} depth={depth+1} collapsible={collapsible}/>
  </Box>:null}
 </Box>;
}
function MenuLinks({items,context,depth=0,horizontal=false,collapsible=false}:{items:PublicMenuNode[];context:LinkContext;depth?:number;horizontal?:boolean;collapsible?:boolean}){
 if(depth>=MAX_MENU_DEPTH)return null;
 return <Box component="ul" sx={{listStyle:"none",m:0,p:0,pl:depth&&!collapsible?1:0,minWidth:0,display:horizontal?"flex":"block",flexWrap:"wrap",alignItems:"center",columnGap:3}}>
  {items.slice(0,1000).map((item,index)=><MenuBranch key={`${index}-${item.href}`} item={item} context={context} depth={depth} collapsible={collapsible}/>)}
 </Box>;
}
const OPEN_EVENT="uog:site-navigation-open";

/** Conventional disclosure navigation: native buttons/links, not an application menubar. */
function DropdownNavigation({items,label,context}:{items:PublicMenuNode[];label:string;context:LinkContext}) {
 const id=useId();
 const root=useRef<HTMLElement|null>(null);
 const [active,setActive]=useState<number|null>(null);
 const [left,setLeft]=useState(0),[height,setHeight]=useState(640);
 const focusEdge=useRef<"first"|"last"|null>(null);
 const hoverOpened=useRef(false);
 const triggerAt=(index:number)=>root.current?.querySelector<HTMLElement>(`[data-nav-index="${index}"]`);
 function activate(index:number) {
  const bounds=root.current?.getBoundingClientRect(),trigger=triggerAt(index)?.getBoundingClientRect();
  const grouped=items[index]?.children?.some(child=>child.children?.length);
  const panelWidth=Math.min(grouped?920:360,window.innerWidth-32);
  setLeft(bounds&&trigger?Math.max(16-bounds.left,Math.min(trigger.left-bounds.left,Math.min(bounds.right,window.innerWidth-16)-bounds.left-panelWidth)):0);
  setHeight(Math.min(640,Math.max(160,window.innerHeight-(bounds?.bottom??0)-20)));
  document.dispatchEvent(new CustomEvent(OPEN_EVENT,{detail:id}));
  setActive(index);
 }
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setActive(null);};
  const another=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)setActive(null);};
  const resize=()=>setActive(null);
  document.addEventListener("pointerdown",outside);document.addEventListener(OPEN_EVENT,another);window.addEventListener("resize",resize);
  return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener(OPEN_EVENT,another);window.removeEventListener("resize",resize);};
 },[id]);
 useEffect(()=>{setActive(null);},[items,context.currentPath]);
 useEffect(()=>{
  if(active===null||!focusEdge.current)return;
  const links=root.current?.querySelectorAll<HTMLElement>("[data-nav-panel] a[href]");
  const target=focusEdge.current==="last"?links?.[links.length-1]:links?.[0];focusEdge.current=null;target?.focus();
 },[active]);
 const panelContext={...context,onNavigate:()=>{setActive(null);context.onNavigate?.();}};
 function topKey(event:React.KeyboardEvent,index:number) {
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  hoverOpened.current=false;
  if(event.key==="ArrowRight"||event.key==="ArrowLeft"){
   event.preventDefault();const step=event.key==="ArrowRight"?1:-1;let next=index;
   for(let count=0;count<items.length;count++){next=(next+step+items.length)%items.length;if(triggerAt(next))break;}
   triggerAt(next)?.focus();if(active!==null){if(items[next]?.children?.length)activate(next);else setActive(null);}
  } else if((event.key==="ArrowDown"||event.key==="ArrowUp")&&items[index]?.children?.length){
   event.preventDefault();focusEdge.current=event.key==="ArrowUp"?"last":"first";
   if(active===index){const links=root.current?.querySelectorAll<HTMLElement>("[data-nav-panel] a[href]");(event.key==="ArrowUp"?links?.[links.length-1]:links?.[0])?.focus();focusEdge.current=null;}else activate(index);
  }
 }
 return <Box component="nav" ref={root} aria-label={label}
  onPointerLeave={event=>{if(event.pointerType==="mouse")setActive(null);}}
  onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setActive(null);}}
  onKeyDown={event=>{if(event.key==="Escape"&&active!==null){event.preventDefault();event.stopPropagation();const index=active;setActive(null);triggerAt(index)?.focus();}}}
  sx={{position:"relative",minWidth:0,overflowWrap:"anywhere","& [data-nav-trigger]":{minHeight:60,px:1.5,borderBottomWidth:3,"&:focus-visible":{outlineColor:"secondary.main",outlineOffset:-4}}}}>
  <Box component="ul" sx={{display:"flex",flexWrap:"wrap",gap:0,listStyle:"none",m:0,p:0}}>
   {items.map((item,index)=>{
    const expanded=active===index;
    const grouped=Boolean(item.children?.some(child=>child.children?.length));
    const width=grouped?920:360;
    return <Box component="li" key={`${index}-${item.label}`} sx={{minWidth:0,maxWidth:"100%"}}
     onPointerEnter={event=>{if(event.pointerType==="mouse"){if(item.children?.length){hoverOpened.current=true;activate(index);}else setActive(null);}}}>
     {item.children?.length?<>
      <ButtonBase type="button" data-nav-trigger data-nav-index={index} aria-expanded={expanded} aria-controls={expanded?`${id}-${index}`:undefined}
       onClick={()=>{if(hoverOpened.current){hoverOpened.current=false;activate(index);}else expanded?setActive(null):activate(index);}} onKeyDown={event=>topKey(event,index)}
       onFocus={()=>{if(active!==null&&active!==index)activate(index);}}
       sx={{minHeight:60,px:1.5,gap:.75,color:"inherit",font:"inherit",fontWeight:650,borderBottom:"3px solid",borderColor:expanded?"secondary.main":"transparent",bgcolor:expanded?"action.selected":"transparent","&:hover":{bgcolor:"action.hover"},"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:-4}}}>
       {item.label}<ExpandMoreRoundedIcon aria-hidden sx={{fontSize:18,opacity:.8,transform:expanded?"rotate(180deg)":"none",transition:"transform 150ms ease","@media (prefers-reduced-motion: reduce)":{transition:"none"}}}/>
      </ButtonBase>
      {expanded?<Box id={`${id}-${index}`} data-nav-panel role="region" aria-label={`${item.label} links`}
       sx={{position:"absolute",top:"100%",left,width,maxWidth:"calc(100vw - 32px)",maxHeight:height,overflowY:"auto",overscrollBehavior:"contain",zIndex:30,bgcolor:"background.paper",color:"text.primary",border:1,borderColor:"divider",borderTop:"3px solid",borderTopColor:"secondary.main",borderRadius:"0 0 12px 12px",boxShadow:"0 20px 48px rgba(0,25,50,.18),0 2px 8px rgba(0,25,50,.08)",p:{xs:2,md:3.5},boxSizing:"border-box","& a":{display:"flex",minHeight:44,width:"100%",boxSizing:"border-box",fontWeight:400,px:1,py:.75,borderBottom:0,borderRadius:1,"&:hover":{bgcolor:"action.hover",color:"primary.main"}},"& ul":{pl:0},"& section + section":{borderLeft:0}}}>
       <NavigationPanel item={item} context={panelContext}/>
      </Box>:null}
     </>:<Box onKeyDown={event=>topKey(event,index)} onFocus={()=>setActive(null)}><NavigationLink item={item} context={panelContext} rootTrigger rootIndex={index}/></Box>}
    </Box>;
   })}
  </Box>
 </Box>;
}

function NavigationPanel({item,context}:{item:PublicMenuNode;context:LinkContext}) {
 const children=item.children??[];
 const groups=children.filter(child=>child.children?.length);
 const sections:{group?:PublicMenuNode;leaves:PublicMenuNode[]}[]=[];
 for(const child of children){
  if(child.children?.length)sections.push({group:child,leaves:[]});
  else {const previous=sections[sections.length-1];if(previous&&!previous.group)previous.leaves.push(child);else sections.push({leaves:[child]});}
 }
 const hasOverview=Boolean(safeMenuHref(item.href))&&!children.some(child=>!child.children?.length&&child.href===item.href);
 return <>
  <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,pb:1.5,mb:1.5,borderBottom:1,borderColor:"divider"}}>
   <Typography component="p" variant="overline" sx={{fontWeight:800,letterSpacing:".09em",color:"primary.main"}}>{item.label}</Typography>
   {hasOverview?<Box sx={{flexShrink:0}}><NavigationLink item={item} context={context}>Overview</NavigationLink></Box>:null}
  </Box>
  {groups.length?<Box sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",md:`repeat(${Math.min(3,sections.length)},minmax(0,1fr))`},gap:{xs:2,md:4}}}>
   {sections.map(({group,leaves},index)=><Box key={`${index}-${group?.label??"general"}`} component="section" sx={{minWidth:0}}>
    <Typography component="p" variant="overline" sx={{fontWeight:800,letterSpacing:".06em",mb:1,pb:1,borderBottom:1,borderColor:"divider"}}>{group?.label??"General"}</Typography>
    <MenuLinks items={group?.children??leaves} context={context} depth={group?2:1} collapsible/>
    {group&&safeMenuHref(group.href)&&group.href!==item.href?<NavigationLink item={group} context={context}>View all {group.label.toLowerCase()}</NavigationLink>:null}
   </Box>)}
  </Box>:<MenuLinks items={children} context={context} depth={1} collapsible/>}
 </>;
}

function MobileMenuLinks({items,context,depth=0}:{items:PublicMenuNode[];context:LinkContext;depth?:number}) {
 const [active,setActive]=useState<number|null>(null);
 const id=useId();
 if(depth>=MAX_MENU_DEPTH)return null;
 return <Box component="ul" onKeyDown={event=>{if(event.key==="Escape"&&depth>0&&active!==null){event.preventDefault();event.stopPropagation();const button=event.currentTarget.querySelector<HTMLElement>(`[data-mobile-index="${active}"]`);setActive(null);button?.focus();}}} sx={{listStyle:"none",p:0,m:0,pl:depth?1.25:0,"& a":{width:"100%",boxSizing:"border-box",py:.75,borderBottom:0}}}>
  {items.map((item,index)=><Box component="li" key={`${index}-${item.label}`} sx={{borderBottom:depth?0:1,borderColor:"divider"}}>
   {item.children?.length?<>
    <ButtonBase data-mobile-index={index} type="button" aria-expanded={active===index} aria-controls={active===index?`${id}-${index}`:undefined} onClick={()=>setActive(active===index?null:index)}
     sx={{width:"100%",justifyContent:"space-between",textAlign:"start",gap:1,minHeight:48,px:1,font:"inherit",fontWeight:650,borderRadius:1,"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:-3}}}>
     {item.label}<ExpandMoreRoundedIcon aria-hidden sx={{fontSize:20,transform:active===index?"rotate(180deg)":"none"}}/>
    </ButtonBase>
    {active===index?<Box id={`${id}-${index}`} sx={{pb:1.5}}><NavigationLink item={item} context={context}>Overview</NavigationLink><MobileMenuLinks items={item.children} context={context} depth={depth+1}/></Box>:null}
   </>:<NavigationLink item={item} context={context}/>}
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
 if(dropdown)return <DropdownNavigation items={items} label={label} context={context}/>;
 return <Box component="nav" aria-label={label} sx={{px:2,py:mobile?1:0.5,minWidth:0,maxWidth:"100%"}}>
  {mobile?<>
   <Box sx={{display:{xs:"none",lg:"block"}}}><SiteNavigation items={items} label={`${label} desktop`} dropdown currentPath={context.currentPath} siteOrigin={siteOrigin} openLinksInNewTab={openLinksInNewTab}/></Box>
   <IconButton aria-label={`Open ${label.toLowerCase()}`} aria-expanded={open} aria-controls={menuId} onClick={()=>setOpen(true)} sx={{color:"inherit",display:{xs:"inline-flex",lg:"none"},"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}><MenuIcon/></IconButton>
   <Drawer anchor="left" open={open} onClose={()=>setOpen(false)}><Box sx={{width:340,maxWidth:"calc(100vw - 16px)",boxSizing:"border-box",p:2}} id={menuId}>
    <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",mb:2,pb:1,borderBottom:1,borderColor:"divider"}}><Typography fontWeight={800}>Navigation</Typography><IconButton aria-label={`Close ${label.toLowerCase()}`} onClick={()=>setOpen(false)} sx={{"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}><CloseIcon/></IconButton></Box>
    <Box component="div" role="navigation" aria-label={label}><MobileMenuLinks items={items} context={{...context,onNavigate:()=>setOpen(false)}}/></Box>
   </Box></Drawer>
  </>:<MenuLinks items={items} context={context} horizontal={label!=="Page sidebar"}/> }
 </Box>;
}
export function PublicMenuFrame({utility=[],header,footer,children,...context}:{header:PublicMenuNode[];footer:PublicMenuNode[];utility?:PublicMenuNode[];children:ReactNode;currentPath?:string;siteOrigin?:string;openLinksInNewTab?:boolean}){
 return <><SiteNavigation items={utility} label="Site utility" mobile {...context}/><SiteNavigation items={header} label="Site header" mobile {...context}/>{children}<SiteNavigation items={footer} label="Site footer" {...context}/></>;
}
