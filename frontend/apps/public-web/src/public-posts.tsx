"use client";

/**
 * Public Post feed and detail.
 *
 * Both views call the host-resolved Post API. Category and tag filters are
 * slugs for this Site only. A draft, another Site's Post, or a disabled
 * POSTS module comes back as not found and is not rendered.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  postFromResponse,
  postMetadata,
  postsPageFromResponse,
  publicFetchInit,
  PublicPostDetail,
  PublicPostFeed,
  siteFromContext,
} from "@uog/ui";
import type { PublicPostDocument, PublicPostPageResult, PublicSiteContext } from "@uog/ui";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function filterValue(value: string | null): string {
  return value && SLUG.test(value) ? value : "";
}

function applyDocumentMetadata(site: PublicSiteContext, post: PublicPostDocument | null) {
  const metadata = postMetadata(site, post);
  document.title = metadata.title;
  let description = document.querySelector('meta[name="description"]');
  if (!description) {
    description = document.createElement("meta");
    description.setAttribute("name", "description");
    document.head.appendChild(description);
  }
  description.setAttribute("content", metadata.description);
}

export function PublicPostsPage({ archiveSlug }: { archiveSlug?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const category = archiveSlug ?? filterValue(search.get("category"));
  const basePath = archiveSlug ? `/posts/categories/${encodeURIComponent(archiveSlug)}` : "/posts";
  const [categoryName,setCategoryName] = useState("");
  const tag = filterValue(search.get("tag"));
  const page = search.get("page") ?? "1";
  const pageSize = search.get("page_size") ?? "20";
  const [draftCategory,setDraftCategory] = useState(category);
  const [draftTag,setDraftTag] = useState(tag);
  const [attempt,setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);
  const identity = JSON.stringify([archiveSlug,search.toString(),category,tag,page,pageSize,attempt]);
  const [view,setView] = useState<{key:string;phase:"loading"|"ready"|"disabled"|"error";data:PublicPostPageResult|null;message:string}>({key:"",phase:"loading",data:null,message:""});
  const current = view.key === identity ? view : null;

  useEffect(() => {
    setDraftCategory(category); setDraftTag(tag);
    const controller = new AbortController();
    let cancelled = false;
    setView({key:identity,phase:"loading",data:null,message:""});
    async function load() {
      try {
        const context = await fetch("/api/v1/site-context/",{...publicFetchInit(),signal:controller.signal});
        if (!context.ok) throw new Error("News is temporarily unavailable. Please try again.");
        const site = siteFromContext(context.status,await context.json());
        if (!site.modules.posts || site.id == null) {
          if (!cancelled) setView({key:identity,phase:"disabled",data:null,message:""});
          return;
        }
        const params = new URLSearchParams(search.toString());
        if (!params.has("page")) params.set("page",page);
        if (!params.has("page_size")) params.set("page_size",pageSize);
        if (category && !archiveSlug) params.set("category",category);
        if (tag) params.set("tag",tag);
        const endpoint = archiveSlug ? `/api/v1/site-context/posts/categories/${encodeURIComponent(archiveSlug)}/` : "/api/v1/site-context/posts/";
        const response = await fetch(`${endpoint}?${params}`,{...publicFetchInit(),signal:controller.signal});
        if (!response.ok) throw new Error(response.status === 400 || response.status === 404 ? "This news page is unavailable. Return to the first page or adjust your filters." : "News is temporarily unavailable. Please try again.");
        const body = await response.json();
        const data = postsPageFromResponse(response.status,body,site.id);
        if (archiveSlug && (typeof body.category?.name !== "string" || body.category.slug !== archiveSlug)) throw new Error("This category is unavailable.");
        if (!data) throw new Error("News could not be loaded safely. Please try again.");
        if (cancelled) return;
        setCategoryName(archiveSlug ? body.category.name : "");
        setView({key:identity,phase:"ready",data,message:""});
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          requestAnimationFrame(() => heading.current?.focus());
        }
      } catch (error) {
        if (!cancelled) setView({key:identity,phase:"error",data:null,message:error instanceof Error && error.name === "Error" ? error.message : "News is temporarily unavailable. Please try again."});
      }
    }
    void load();
    return () => {cancelled=true;controller.abort();};
  },[identity,archiveSlug,category,tag,page,pageSize]);

  function navigate(nextPage:number,resetSize=false,clearFilters=false) {
    const params = new URLSearchParams();
    if (search.has("locale")) params.set("locale",search.get("locale")!);
    if (!archiveSlug && !clearFilters && category) params.set("category",category);
    if (!clearFilters && tag) params.set("tag",tag);
    if (nextPage > 1) params.set("page",String(nextPage));
    if (!resetSize && pageSize !== "20") params.set("page_size",pageSize);
    focusAfterLoad.current = true;
    router.push(params.size ? `${basePath}?${params}` : basePath,{scroll:false});
  }
  const loading = !current || current.phase === "loading";
  const data = current?.data;
  return <Box sx={{display:"flex",flexDirection:"column",gap:3,width:"100%"}} aria-busy={loading}>
    <Typography ref={heading} tabIndex={-1} variant="h1" component="h1" sx={{fontSize:{xs:"2rem",sm:"2.75rem"},fontWeight:700}}>{archiveSlug ? (current?.phase === "ready" ? categoryName : "Category archive") : "News"}</Typography>
    {archiveSlug ? <Button href="/posts" sx={{alignSelf:"flex-start"}}>All news</Button> : null}
    <Box component="form" aria-label="Post filters" onSubmit={event => {
      event.preventDefault();
      const params = new URLSearchParams();
      if (!archiveSlug && SLUG.test(draftCategory)) params.set("category",draftCategory);
      if (SLUG.test(draftTag)) params.set("tag",draftTag);
      focusAfterLoad.current=true;
      router.push(params.size ? `${basePath}?${params}` : basePath,{scroll:false});
    }} sx={{display:"flex",flexDirection:{xs:"column",sm:"row"},gap:2,alignItems:{sm:"center"}}}>
      {!archiveSlug ? <TextField label="Category" value={draftCategory} onChange={event=>setDraftCategory(event.target.value.trim())} size="small" /> : null}
      <TextField label="Tag" value={draftTag} onChange={event=>setDraftTag(event.target.value.trim())} size="small" />
      <Button type="submit" variant="contained">Apply</Button>
      {(!archiveSlug && category) || tag ? <Button onClick={()=>navigate(1,true,true)}>Clear filters</Button> : null}
    </Box>
    {loading ? <><Typography role="status">Loading news...</Typography><Box aria-hidden sx={{display:"grid",gridTemplateColumns:{xs:"1fr",sm:"repeat(2,1fr)",lg:"repeat(3,1fr)"},gap:3}}>{[0,1,2].map(index=><Skeleton key={index} variant="rounded" height={280} />)}</Box></> : null}
    {current?.phase === "disabled" ? <Typography role="status">News is not available for this Site.</Typography> : null}
    {current?.phase === "error" ? <Alert severity="error" action={<Box sx={{display:"flex",flexWrap:"wrap"}}><Button color="inherit" onClick={()=>{focusAfterLoad.current=true;setAttempt(value=>value+1);}}>Try again</Button><Button color="inherit" onClick={()=>navigate(1,true)}>Return to first page</Button></Box>}>{current.message}</Alert> : null}
    {current?.phase === "ready" && data ? <>
      {archiveSlug && data.count === 0 ? <Typography role="status">No published articles in this category yet. Browse all news for more updates.</Typography> : <PublicPostFeed posts={data.posts} />}
      {data.count > 0 ? <Box component="nav" aria-label="News pagination" sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,flexWrap:"wrap"}}>
        <Button disabled={!data.hasPrevious} onClick={()=>navigate(Number(page)-1)}>Previous page</Button>
        <Typography role="status">Page {Number(page)} | {data.count} articles</Typography>
        <Button disabled={!data.hasNext} onClick={()=>navigate(Number(page)+1)}>Next page</Button>
      </Box> : null}
    </> : null}
  </Box>;
}

export function PublicPostPage({ slug }: { slug: string }) {
  return <ScopedPublicPost key={slug} slug={slug} />;
}

function ScopedPublicPost({ slug }: { slug: string }) {
  const [post, setPost] = useState<PublicPostDocument | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!SLUG.test(slug)) {
      setPost(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    fetch("/api/v1/site-context/", publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .then(async (site) => {
        if (!site.modules.posts) {
          applyDocumentMetadata(site, null);
          return null;
        }
        const response = await fetch(`/api/v1/site-context/posts/${slug}/`, publicFetchInit());
        const body = response.ok ? await response.json().catch(() => null) : null;
        const document = postFromResponse(response.status, body);
        const visible = document && (document.site === undefined || document.site === site.id) ? document : null;
        applyDocumentMetadata(site, visible);
        return visible;
      })
      .catch(() => null)
      .then((next) => {
        if (!cancelled) {
          setPost(next);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!ready) return <Typography role="status">Loading published post…</Typography>;
  return <PublicPostDetail post={post} />;
}
