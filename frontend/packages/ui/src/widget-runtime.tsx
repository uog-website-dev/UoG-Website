"use client";

import {createContext, useCallback, useContext, useEffect, useId, useRef, useState} from "react";
import type {ReactNode, FormEvent} from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import { menusFromResponse, SiteNavigation } from "./site-navigation";

export interface WidgetPost {
  id:string;
  site:number;
  title:string;
  slug:string;
  excerpt:string;
  featured_media:string;
  featured_alt?:string;
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
  const [filters,setFilters]=useState({category:"",tag:""});
  const [post,setPost]=useState<WidgetPost|null>(null);
  const pending=useRef(new Map<string,Promise<WidgetEnvelope>>());
  const controllers=useRef(new Set<AbortController>());
  useEffect(()=>()=>{controllers.current.forEach(controller=>controller.abort());pending.current.clear();},[]);
  const load=useCallback((query:Record<string,string>)=>{
    const key=new URLSearchParams(query).toString();
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
      const response=await fetch(`${endpoint}?${key}`,{cache:"no-store",signal:controller.signal,headers:{Accept:"application/json"}});
      if(!response.ok)throw new Error(response.status===404?"This content source is unavailable for this Site.":"Content could not be loaded. Try again.");
      const body=await response.json() as WidgetEnvelope;
      if(body.site!==siteId || !Array.isArray(body.results))throw new Error("Content does not belong to the active Site.");
      return body;
    })();
    pending.current.set(key,request);
    void request.finally(()=>{pending.current.delete(key);controllers.current.delete(controller);}).catch(()=>{});
    return request;
  },[siteId,pageId,preview,mediaBase]);
  return <ScopeContext.Provider value={{siteId,pageId,preview,mediaBase,filters,
    setFilter:(key,value)=>setFilters(current=>({...current,[key]:value})),selectPost:setPost,load}}>
    <PostContext.Provider value={post??inheritedPost}>{children}</PostContext.Provider>
  </ScopeContext.Provider>;
}

function useWidgetData(query:Record<string,string>) {
  const scope=useContext(ScopeContext);
  const key=JSON.stringify(query);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data:WidgetEnvelope|null;error:string|null}>({key:"",data:null,error:null});
  useEffect(()=>{
    let active=true;
    if(!scope)return;
    setState({key,data:null,error:null});
    void scope.load(JSON.parse(key)).then(data=>{if(active)setState({key,data,error:null});})
      .catch(error=>{if(active)setState({key,data:null,error:error instanceof Error?error.message:"Content is unavailable."});});
    return ()=>{active=false;};
  },[key,scope?.load,attempt]);
  return {data:state.key===key?state.data:null,error:state.key===key?state.error:null,retry:()=>setAttempt(value=>value+1)};
}

function DataState({error,retry}:{error:string|null;retry:()=>void}) {
  if(error)return <Alert severity="warning" action={<Button onClick={retry}>Retry</Button>}>{error}</Alert>;
  return <Typography role="status">Loading content…</Typography>;
}

export function SiteTitleWidget() {
  const state=useWidgetData({source:"identity"});
  if(!state.data)return <DataState {...state}/>;
  return <Typography variant="h2">{String(state.data.results[0]?.name??"")}</Typography>;
}

export function MenuWidget({menu_code}:{menu_code:string}) {
  const state=useWidgetData({source:"menu",menu_code});
  if(!state.data)return <DataState {...state}/>;
  const menu=menusFromResponse(200,{locations:{header:state.data.results}}).header;
  if(!menu.length)return <Typography role="status">No published navigation links are available.</Typography>;
  return <SiteNavigation items={menu} label="Page navigation" dropdown/>;
}

function libraryBase(scope:WidgetScope) {
  return scope.mediaBase?.split("/pages/")[0];
}

export function SiteLogoWidget() {
  const scope=useContext(ScopeContext);
  const state=useWidgetData({source:"identity"});
  const [failed,setFailed]=useState(false);
  if(!state.data)return <DataState {...state}/>;
  const identity=state.data.results[0];
  const name=String(identity?.name??"");
  const asset=identity?.logo_asset_id;
  let src=typeof identity?.logo_url==="string" && identity.logo_url==="/api/v1/site-context/identity/logo/" ? identity.logo_url:null;
  if(scope?.preview && typeof asset==="string" && uuid.test(asset)){
    const base=libraryBase(scope);
    src=base?`${base.endsWith("/media")?base:`${base}/media`}/${asset}/image?variant=display`:null;
  }
  if(!src || failed)return <Typography fontWeight={700}>{name}</Typography>;
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
      ? {width:"100%",maxHeight:{xs:240,sm:360,md:440},objectFit:"cover",display:"block"}
      : {maxWidth:"100%",height:"auto"}}
  />;
}

function asPost(row:Record<string,unknown>,siteId:number|null):WidgetPost|null {
  if(row.site!==siteId || typeof row.id!=="string" || typeof row.title!=="string" || typeof row.slug!=="string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))return null;
  return {id:row.id,site:row.site as number,title:row.title,slug:row.slug,
    featured_alt:typeof row.featured_alt==="string"?row.featured_alt:"",excerpt:typeof row.excerpt==="string"?row.excerpt:"",featured_media:typeof row.featured_media==="string"?row.featured_media:""};
}

export function LoopGridWidget({source,limit,category}:{source:"posts"|"pages";limit:number;category?:string}) {
  const scope=useContext(ScopeContext);
  const query:Record<string,string>={source,limit:String(limit)};
  if(category || scope?.filters.category)query.category=category || scope!.filters.category;
  if(scope?.filters.tag)query.tag=scope.filters.tag;
  const state=useWidgetData(query);
  if(!state.data)return <DataState {...state}/>;
  if(!state.data.results.length)return <Typography role="status">No published {source} match these filters.</Typography>;
  return <Box aria-label="Published content grid" sx={{display:"grid",gridTemplateColumns:"1fr","@container visual-layout (min-width: 600px)":{gridTemplateColumns:"repeat(2,minmax(0,1fr))"},gap:2}}>
    {state.data.results.map(row=>{
      if(source==="pages"){
        if(row.site!==scope?.siteId || typeof row.path!=="string" || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(row.path))return null;
        return <Box component="article" key={String(row.id)}><Link href={row.path}>{String(row.title)}</Link></Box>;
      }
      const post=asPost(row,scope?.siteId??null);
      if(!post)return null;
      return <VisualPostProvider key={post.id} post={post} siteId={scope?.siteId??null}>
        <Box component="article"><FeaturedImageWidget compact/><Link href={`/posts/${post.slug}`}><PostTitleWidget/></Link><PostExcerptWidget/></Box>
      </VisualPostProvider>;
    })}
  </Box>;
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
