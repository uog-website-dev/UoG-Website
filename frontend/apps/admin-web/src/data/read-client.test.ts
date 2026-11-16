// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {loadSitePages,loadSitePosts,listSiteMedia,loadSiteTaxonomy,loadSiteNavigation,getSiteDashboardSummary,loadSitePageStatusCounts} from "./read-client";
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("projects only lifecycle counts so the Page total is not counted twice",async()=>{
  const counts={total:3,DRAFT:2,IN_REVIEW:0,APPROVED:0,PUBLISHED:1,UNPUBLISHED:0,ARCHIVED:0};
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({schema_version:1,site:11,generated_at:new Date().toISOString(),expires_at:new Date(Date.now()+15000).toISOString(),partial:false,cache:{hit:false,available:true,ttl_seconds:15},sections:{pages:{status:"ready",counts}}})));
  const result=await loadSitePageStatusCounts(11);expect(result.ok).toBe(true);if(result.ok){expect(result.data).not.toHaveProperty("total");expect(Object.values(result.data).reduce((a,b)=>a+b,0)).toBe(3);}
});
it("uses same-origin credentialed GET without tokens, forwards filters and aborts obsolete reads",async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({count:0,results:[]}));vi.stubGlobal("fetch",fetcher);
  const controller=new AbortController();expect((await loadSitePages(11,{search:"Science & health",page:2},controller.signal)).ok).toBe(true);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toContain("/admin/api/reads?");expect(url).toContain("resource=pages");expect(url).toContain("search=Science+%26+health");expect(init.credentials).toBe("same-origin");expect(new Headers(init.headers).has("Authorization")).toBe(false);
  fetcher.mockImplementation((_url,options)=>new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")))));
  const pending=loadSitePosts(11,{},controller.signal);controller.abort();await expect(pending).rejects.toBeDefined();
});
it("keeps backend field errors and validates dashboard Site/schema",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{code:"validation_error",message:"Invalid",details:{status:["Invalid"]}}},{status:400})));
  const result=await listSiteMedia(11);expect(result.ok).toBe(false);if(!result.ok)expect(result.error.details).toEqual({status:["Invalid"]});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({site:22})));expect((await getSiteDashboardSummary(11)).ok).toBe(false);
});
it("fetches directory and policy in parallel with bounded pages",async()=>{
  let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  const fetcher=vi.fn(async(url:string)=>{if(url.includes("resource=menus")){await held;return Response.json({results:[{id:"menu",site:11,version:3}],next:null});}return Response.json([]);});vi.stubGlobal("fetch",fetcher);
  const pending=loadSiteNavigation(11,false);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));release();const result=await pending;expect(result.ok).toBe(true);if(result.ok)expect(result.data.menus[0]?.etag).toBe('"menu-menu-v3"');
});
it("does not follow upstream next URLs or truncate taxonomy pages",async()=>{
  const fetcher=vi.fn(async(url:string)=>Response.json({results:[{id:url.includes("page=2")?"second":"first",site:11}],next:url.includes("page=2")?null:"https://untrusted.test/secret"}));vi.stubGlobal("fetch",fetcher);
  const result=await loadSiteTaxonomy(11,"categories");expect(result.ok).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.every(([url])=>url.startsWith("/admin/api/reads?"))).toBe(true);
});
