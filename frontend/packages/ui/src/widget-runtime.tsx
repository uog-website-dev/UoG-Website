"use client";

import {createContext, useCallback, useContext, useEffect, useId, useRef, useState} from "react";
import type {ReactNode, FormEvent} from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import {usePublicSiteBranding, publicLogoSource} from "./site-branding";
import {HorizontalCards,containedImageHover,newsCardHover} from "./horizontal-cards";
import {ContentCarousel} from "./visual-presentation";
import { menusFromResponse, SiteNavigation } from "./site-navigation";

export interface WidgetPost {
  id:string;
  site:number;
  title:string;
  slug:string;
  excerpt:string;
  featured_media:string;
  featured_alt?:string;
  published_at?:string;
}
interface WidgetEnvelope {site:number; results:Record<string,unknown>[]}
interface WidgetScope {
  siteId:number|null;
  pageId?:string;
  preview:boolean;
  mediaBase?:string;
  filters:{category:string;tag:string};
  setFilter:(key:"category"|"tag",value:string)=>void;
  selectPost:(post:WidgetPost|null)=>void;
  load:(query:Record<string,string>)=>Promise<WidgetEnvelope>;
}
const ScopeContext=createContext<WidgetScope|null>(null);
const PostContext=createContext<WidgetPost|null>(null);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function WidgetRuntimeProvider(props:{siteId:number|null;pageId?:string;preview?:boolean;mediaBase?:string;children:ReactNode}) {
  return <WidgetScopeProvider key={`${props.siteId}:${props.pageId}:${Boolean(props.preview)}`} {...props}/>;
}

function WidgetScopeProvider({siteId,pageId,preview=false,mediaBase,children}:{siteId:number|null;pageId?:string;preview?:boolean;mediaBase?:string;children:ReactNode}) {
  const inheritedPost=useContext(PostContext);
  const branding=usePublicSiteBranding();
  const identityRevision=branding.id===siteId
    ? branding.brandingRevision ?? JSON.stringify([branding.displayName,branding.theme,branding.logoUrl]) : "";
  const [filters,setFilters]=useState({category:"",tag:""});
  const [post,setPost]=useState<WidgetPost|null>(null);
  const pending=useRef(new Map<string,Promise<WidgetEnvelope>>());
  const controllers=useRef(new Set<AbortController>());
  useEffect(()=>()=>{controllers.current.forEach(controller=>controller.abort());pending.current.clear();},[]);
  const load=useCallback((query:Record<string,string>)=>{
    const params=new URLSearchParams(query).toString();
    const key=JSON.stringify([identityRevision,params]);
    const existing=pending.current.get(key);
    if(existing)return existing;
    const controller=new AbortController();
    controllers.current.add(controller);
    const request=(async()=>{
      if(siteId===null)throw new Error("Choose a Site to load this content.");
      let endpoint="/api/v1/site-context/widgets/";
      if(preview){
        if(!pageId || !uuid.test(pageId))throw new Error("Reload the Page to load preview data.");
        const prefix=mediaBase?.split(`/sites/${siteId}/`)[0];
        if(prefix===undefined)throw new Error("Preview data is unavailable.");
        endpoint=`${prefix}/sites/${siteId}/pages/${pageId}/widget-data`;
      }
      const response=await fetch(`${endpoint}?${params}`,{cache:"no-store",signal:controller.signal,headers:{Accept:"application/json"}});
      if(!response.ok)throw new Error(response.status===404?"This content source is unavailable for this Site.":"Content could not be loaded. Try again.");
      const body=await response.json() as WidgetEnvelope;
      if(body.site!==siteId || !Array.isArray(body.results))throw new Error("Content does not belong to the active Site.");
      return body;
    })();
    pending.current.set(key,request);
    void request.finally(()=>{pending.current.delete(key);controllers.current.delete(controller);}).catch(()=>{});
    return request;
  },[siteId,pageId,preview,mediaBase,identityRevision]);
  return <ScopeContext.Provider value={{siteId,pageId,preview,mediaBase,filters,
    setFilter:(key,value)=>setFilters(current=>({...current,[key]:value})),selectPost:setPost,load}}>
    <PostContext.Provider value={post??inheritedPost}>{children}</PostContext.Provider>
  </ScopeContext.Provider>;
}

function useWidgetData(query:Record<string,string>,enabled=true) {
  const scope=useContext(ScopeContext);
  const key=JSON.stringify(query);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data:WidgetEnvelope|null;error:string|null}>({key:"",data:null,error:null});
  useEffect(()=>{
    let active=true;
    if(!scope||!enabled)return;
    setState({key,data:null,error:null});
    void scope.load(JSON.parse(key)).then(data=>{if(active)setState({key,data,error:null});})
      .catch(error=>{if(active)setState({key,data:null,error:error instanceof Error?error.message:"Content is unavailable."});});
    return ()=>{active=false;};
  },[key,scope?.load,attempt,enabled]);
  return {data:state.key===key?state.data:null,error:state.key===key?state.error:null,retry:()=>setAttempt(value=>value+1)};
}

function DataState({error,retry}:{error:string|null;retry:()=>void}) {
  if(error)return <Alert severity="warning" action={<Button onClick={retry}>Retry</Button>}>{error}</Alert>;
  return <Typography role="status">Loading content…</Typography>;
}

export function SiteTitleWidget() {
  const scope=useContext(ScopeContext);
  const state=useWidgetData({source:"identity"});
  if(scope?.siteId===null)return <Typography component="p" variant="h4" color="text.secondary" sx={{fontWeight:700,overflowWrap:"anywhere",my:0}}>Site title placeholder</Typography>;
  if(!state.data)return <DataState {...state}/>;
  return <Typography component="p" variant="h4" sx={{fontWeight:700,overflowWrap:"anywhere",my:0}}>{String(state.data.results[0]?.name??"")}</Typography>;
}

export function MenuWidget({menu_code}:{menu_code:string}) {
  const scope=useContext(ScopeContext);
  const state=useWidgetData({source:"menu",menu_code});
  if(scope?.siteId===null)return <Typography role="status" color="text.secondary">Site navigation placeholder · uses this Site’s published menu</Typography>;
  if(!state.data)return <DataState {...state}/>;
  const menu=menusFromResponse(200,{locations:{header:state.data.results}}).header;
  if(!menu.length)return <Typography role="status">No published navigation links are available.</Typography>;
  return <SiteNavigation items={menu} label="Page navigation" dropdown/>;
}

function libraryBase(scope:WidgetScope) {
  return scope.mediaBase?.split("/pages/")[0];
}

export function SiteLogoWidget() {
  const branding=usePublicSiteBranding();
  const scope=useContext(ScopeContext);
  const state=useWidgetData({source:"identity"});
  const [failed,setFailed]=useState(false);
  const identityKey=JSON.stringify(state.data?.results[0] ?? null);
  useEffect(()=>setFailed(false),[branding,identityKey]);
  if(scope?.siteId===null)return <Box role="img" aria-label="Site logo placeholder" sx={{minHeight:56,minWidth:96,p:1,border:"1px dashed",borderColor:"divider",display:"grid",placeItems:"center",color:"text.secondary",textAlign:"center",fontSize:"0.8rem"}}>Site logo placeholder</Box>;
  if(!state.data)return <DataState {...state}/>;
  const identity=state.data.results[0];
  const name=String(identity?.name??"");
  const asset=identity?.logo_asset_id;
  let src=typeof identity?.logo_url==="string" && identity.logo_url==="/api/v1/site-context/identity/logo/" ? identity.logo_url:null;
  if(!scope?.preview && branding.id===scope?.siteId && src)src=publicLogoSource(branding);
  if(scope?.preview && typeof asset==="string" && uuid.test(asset)){
    const base=libraryBase(scope);
    src=base?`${base.endsWith("/media")?base:`${base}/media`}/${asset}/image?variant=display`:null;
  }
  if(!src || failed)return <Box role="img" aria-label={`Logo unavailable for ${name}`} sx={{minHeight:56,minWidth:96,p:1,border:"1px dashed",borderColor:"divider",display:"grid",placeItems:"center",color:"text.secondary",textAlign:"center",fontSize:"0.8rem"}}>Logo placeholder · {name}</Box>;
  return <Box component="img" src={src} alt={name} onError={()=>setFailed(true)} sx={{maxWidth:"100%",maxHeight:140,objectFit:"contain"}}/>;
}

export function VisualPostProvider({post,siteId,children}:{post:WidgetPost|null;siteId:number|null;children:ReactNode}) {
  return <PostContext.Provider value={post?.site===siteId?post:null}>{children}</PostContext.Provider>;
}

function useCurrentPost() {
  const post=useContext(PostContext);
  const scope=useContext(ScopeContext);
  return post && (!scope || post.site===scope.siteId)?post:null;
}

export function PostTitleWidget({id,level=3}:{id?:string;level?:1|3}={}) {
  const post=useCurrentPost();
  return <Typography id={id} variant={level===1?"h1":"h3"} component={level===1?"h1":"h3"}>{post?post.title:"Choose a Post to preview its title."}</Typography>;
}

export function PostExcerptWidget() {
  const post=useCurrentPost();
  return <Typography>{post?post.excerpt:"Choose a Post to preview its excerpt."}</Typography>;
}

export function FeaturedImageWidget({compact=false,variant="inline"}:{compact?:boolean;variant?:"inline"|"hero"}={}) {
  const post=useCurrentPost();
  const scope=useContext(ScopeContext);
  const reference=post?.featured_media??"";
  const match=/^sites\/([1-9][0-9]*)\/assets\/([0-9a-f-]{36})$/.exec(reference);
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[reference]);
  const omitMissing=compact || variant==="hero";
  if(!post || !match || Number(match[1])!==post.site || !uuid.test(match[2]!) || failed){
    return omitMissing?null:<Typography role="status">{post?"This Post has no available featured image.":"Choose a Post to preview its featured image."}</Typography>;
  }
  let base="/api/v1/site-context/media";
  if(scope?.preview){
    const library=libraryBase(scope);
    if(!library)return null;
    base=library.endsWith("/media")?library:`${library}/media`;
  }
  const src=scope?.preview?`${base}/${match[2]}/image?variant=display`:`${base}/${match[2]}/?variant=display`;
  return <Box
    component="img"
    src={src}
    alt={post.featured_alt || post.title}
    onError={()=>setFailed(true)}
    loading="lazy"
    sx={variant==="hero"
      ? {width:"100%",aspectRatio:{xs:"16/10",md:"16/9"},maxHeight:{xs:280,sm:380,md:480},objectFit:"cover",display:"block"}
      : {maxWidth:"100%",height:"auto"}}
  />;
}

function asPost(row:Record<string,unknown>,siteId:number|null):WidgetPost|null {
  if(row.site!==siteId || typeof row.id!=="string" || typeof row.title!=="string" || typeof row.slug!=="string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))return null;
  return {id:row.id,site:row.site as number,title:row.title,slug:row.slug,
    published_at:typeof row.published_at==="string"&&!Number.isNaN(Date.parse(row.published_at))?row.published_at:undefined,featured_alt:typeof row.featured_alt==="string"?row.featured_alt:"",excerpt:typeof row.excerpt==="string"?row.excerpt:"",featured_media:typeof row.featured_media==="string"?row.featured_media:""};
}

export function LoopGridWidget({source,limit,category,presentation="grid",carousel=false,display="grid",columns,image_hover="zoom"}:{source:"posts"|"pages";limit:number;category?:string;presentation?:"grid"|"list"|"featured";carousel?:boolean;display?:"grid"|"slider";columns?:number;image_hover?:"none"|"zoom"}) {
  const scope=useContext(ScopeContext);
  const query:Record<string,string>={source,limit:String(limit)};
  if(category || scope?.filters.category)query.category=category || scope!.filters.category;
  if(scope?.filters.tag)query.tag=scope.filters.tag;
  const state=useWidgetData(query);
  if(scope?.siteId===null)return <Typography role="status" color="text.secondary">{source === "posts" ? "Site news preview: published articles will appear here." : "Site pages preview: published Pages will appear here."}</Typography>;
  if(!state.data)return <DataState {...state}/>;
  if(!state.data.results.length)return <Typography role="status">No published {source} match these filters.</Typography>;
  const cards=state.data.results.flatMap((row,index)=>{
    if(source==="pages"){
      if(row.site!==scope?.siteId || typeof row.path!=="string" || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(row.path))return [];
      return [{id:String(row.id),content:<Box component="article" sx={{p:3,border:1,borderColor:'divider',borderRadius:2}}><Link href={row.path} sx={{fontWeight:700}}>{String(row.title)}</Link></Box>}];
    }
    const post=asPost(row,scope?.siteId??null);if(!post)return [];
    const compact=display!=='slider'&&(presentation==='list'||(presentation==='featured'&&index>0));
    return [{id:post.id,content:<VisualPostProvider post={post} siteId={scope?.siteId??null}>
      <Box component="article" sx={{...newsCardHover,display:'grid',gridTemplateColumns:compact?{xs:'minmax(0,1fr)',sm:'minmax(100px,30%) minmax(0,1fr)'}:'minmax(0,1fr)',gap:2,pb:3,borderBottom:1,borderColor:'divider',height:'100%',minWidth:0,'&:not(:has(img))':{gridTemplateColumns:'minmax(0,1fr)'},'& img':{width:'100%',height:compact?140:260,objectFit:'cover',borderRadius:2}}}>
        <Box data-image-hover={image_hover} sx={image_hover==='zoom'?containedImageHover:{overflow:'hidden',borderRadius:2}}><Link href={`/posts/${post.slug}`} aria-label={`Read ${post.title}`} sx={{display:'block'}}><FeaturedImageWidget compact/></Link></Box>
        <Box sx={{display:'grid',alignContent:'start',gap:1,minWidth:0}}><Typography component="h3" variant={compact?'h6':'h5'} sx={{lineHeight:1.4,fontWeight:750}}><Link href={`/posts/${post.slug}`} color="inherit" underline="hover">{post.title}</Link></Typography>
          {post.published_at?<Typography component="time" dateTime={post.published_at} variant="body2" color="text.secondary">{new Date(post.published_at).toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}</Typography>:null}
          {!compact?<PostExcerptWidget/>:null}
        </Box>
      </Box>
    </VisualPostProvider>}];
  });
  if(display==='slider')return <HorizontalCards items={cards} columns={columns??3} label={source==='posts'?'News slider':'Pages slider'}/>;
  if(carousel)return <ContentCarousel items={cards} label={source==='posts'?'News carousel':'Pages carousel'}/>;
  return <Box aria-label="Published content grid" data-news-presentation={presentation} sx={{display:'grid',gridTemplateColumns:presentation==='list'?'minmax(0,1fr)':{xs:'minmax(0,1fr)',md:`repeat(${presentation==='featured'?2:columns??2},minmax(0,1fr))`},gap:3}}>{cards.map((card,index)=><Box key={card.id} sx={{minWidth:0,...(presentation==='featured'&&index===0?{gridRow:{md:`span ${Math.max(1,cards.length-1)}`}}:{})}}>{card.content}</Box>)}</Box>;
}

export function TaxonomyWidget({taxonomy_code,limit}:{taxonomy_code:string;limit:number}) {
 const scope=useContext(ScopeContext),state=useWidgetData({source:'taxonomy',taxonomy_code,limit:String(limit)});
 if(scope?.siteId===null)return <Typography>Categories from this Site appear here.</Typography>;
 if(!state.data)return <DataState {...state}/>;
 const terms=state.data.results.filter(row=>typeof row.slug==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug));
 return <Box component="nav" aria-label={taxonomy_code==='tags'?'Tags':'Categories'} sx={{display:'flex',gap:1,flexWrap:'wrap'}}>{terms.length?terms.map(term=><Link key={String(term.id)} href={taxonomy_code==='tags'||taxonomy_code==='tag'?`/posts?tag=${term.slug}`:`/posts/categories/${term.slug}`} sx={{py:1,px:2,minHeight:44,border:1,borderColor:'divider',borderRadius:2}}>{String(term.name)}</Link>):<Typography>No published categories are available.</Typography>}</Box>;
}

export function TaxonomyFilterWidget({taxonomy_code,limit}:{taxonomy_code:string;limit:number}) {
  const scope=useContext(ScopeContext);
  const id=useId();
  const state=useWidgetData({source:"taxonomy",taxonomy_code,limit:String(limit)});
  const key=taxonomy_code==="tags"||taxonomy_code==="tag"?"tag":"category";
  if(!state.data)return <DataState {...state}/>;
  return <Box component="label" htmlFor={id} sx={{display:"grid",gap:1}}>Filter by {key}
    <Box component="select" id={id} value={scope?.filters[key]??""} onChange={event=>scope?.setFilter(key,event.target.value)} sx={{p:1,borderRadius:1,maxWidth:"100%"}}>
      <option value="">All {key==="tag"?"tags":"categories"}</option>
      {state.data.results.map(term=>typeof term.slug==="string"?<option key={String(term.id)} value={term.slug}>{String(term.name)}</option>:null)}
    </Box>
  </Box>;
}

export function PostPreviewSelector() {
  const scope=useContext(ScopeContext);
  const current=useCurrentPost();
  const state=useWidgetData({source:"posts",limit:"20"});
  if(!state.data)return <DataState {...state}/>;
  const posts=state.data.results.map(row=>asPost(row,scope?.siteId??null)).filter((post):post is WidgetPost=>post!==null);
  return <TextField select SelectProps={{native:true}} label="Preview Post context" value={current?.id??""} onChange={event=>scope?.selectPost(posts.find(post=>post.id===event.target.value)??null)}>
    <option value="">Choose a published Post</option>
    {posts.map(post=><option key={post.id} value={post.id}>{post.title}</option>)}
  </TextField>;
}

export function ContactFormWidget({form_code,submit_label}:{form_code:string;submit_label:string}) {
  const scope=useContext(ScopeContext);
  const [values,setValues]=useState({name:"",email:"",message:""});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [sending,setSending]=useState(false);
  const [complete,setComplete]=useState(false);
  const [problem,setProblem]=useState("");
  const requestId=useRef<string|null>(null);
  const alive=useRef(true);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;controller.current?.abort();};},[]);
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(!scope?.pageId || scope.preview || sending)return;
    const invalid:Record<string,string>={};
    if(!values.name.trim())invalid.name="Enter your name.";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))invalid.email="Enter a valid email address.";
    if(!values.message.trim())invalid.message="Enter a message.";
    setErrors(invalid);
    if(Object.keys(invalid).length)return;
    requestId.current??=crypto.randomUUID();
    controller.current=new AbortController();
    setSending(true);setProblem("");
    try{
      const response=await fetch(`/api/v1/site-context/contact/${scope.pageId}/${encodeURIComponent(form_code)}/`,{
        method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...values,request_id:requestId.current}),signal:controller.current.signal});
      if(!alive.current)return;
      if(response.status!==202)throw new Error(response.status===429?"Too many messages. Please try again later.":"Your message could not be accepted. Please retry.");
      setComplete(true);
    }catch(error){if(alive.current)setProblem(error instanceof Error?error.message:"The message could not be sent.");}
    finally{if(alive.current)setSending(false);}
  }
  if(complete)return <Alert severity="success" role="status">Your message has been received.</Alert>;
  const disabled=Boolean(scope?.preview || !scope?.pageId || sending);
  return <Box component="form" aria-label={`Contact ${form_code}`} noValidate onSubmit={submit} sx={{display:"grid",gap:2}}>
    {([{key:"name",label:"Name",type:"text",max:200},{key:"email",label:"Email",type:"email",max:254},{key:"message",label:"Message",type:"text",max:5000}] as const).map(field=><TextField
      key={field.key} label={field.label} name={field.key} required type={field.type} value={values[field.key]}
      disabled={disabled} multiline={field.key==="message"} minRows={field.key==="message"?4:undefined}
      slotProps={{htmlInput:{maxLength:field.max}}} error={Boolean(errors[field.key])} helperText={errors[field.key]}
      onChange={event=>{requestId.current=null;setValues(current=>({...current,[field.key]:event.target.value}));}}/>)}
    {problem?<Alert severity="error">{problem}</Alert>:null}
    <Button type="submit" variant="contained" disabled={disabled}>{sending?"Sending…":submit_label}</Button>
    {scope?.preview?<Typography variant="caption">Messages are accepted from the published Page.</Typography>:null}
  </Box>;
}

export function BreadcrumbsWidget({pageTitle}:{pageTitle:string}) {
 const scope=useContext(ScopeContext),enabled=!!scope?.pageId&&uuid.test(scope.pageId)&&!scope.preview&&scope.siteId!==null;
 const state=useWidgetData({source:'breadcrumbs',...(scope?.pageId?{page_id:scope.pageId}:{})},enabled);
 const rows=state.data?.results.filter(row=>row.site===scope?.siteId&&typeof row.title==='string'&&typeof row.path==='string'&&/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(row.path))??[];
 const ancestors=rows.slice(0,-1).filter(row=>row.path!=='/');
 return (
  <Box
    component="nav"
    aria-label="Breadcrumb"
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 0.75,
      flexWrap: "wrap",
      fontSize: "0.875rem",
      fontWeight: 500,
      letterSpacing: "0.01em",
      color: "text.secondary",
    }}
  >
    <Link href="/" underline="hover" color="inherit" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Home</Link>
    {ancestors.map((row) => (
      <Box key={String(row.path)} sx={{ display: "inline-flex", gap: 0.75, alignItems: "center", minWidth: 0 }}>
        <Box component="span" aria-hidden sx={{ opacity: 0.7, lineHeight: 1 }}>›</Box>
        <Link href={String(row.path)} underline="hover" color="inherit" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>{String(row.title)}</Link>
      </Box>
    ))}
    <Box component="span" aria-hidden sx={{ opacity: 0.7, lineHeight: 1 }}>›</Box>
    <Typography component="span" aria-current="page" color="text.primary" sx={{ m: 0, font: "inherit", fontWeight: 600, maxWidth: { xs: 180, sm: 360 }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pageTitle}</Typography>
  </Box>
 );
}
