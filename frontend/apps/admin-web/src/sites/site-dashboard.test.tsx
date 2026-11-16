import {act, fireEvent, render, screen, waitFor, within} from "@/test/render";
import {beforeEach, expect, it, vi} from "vitest";
import {useState} from "react";
import {queryKey, useQueryEnvironment, useSiteQuery} from "@/data/query-cache";
import {unwrap} from "@/organizations/contract";
import {SiteAdminFrame} from "./site-admin-frame";
import {SiteDashboard} from "./site-dashboard";
import type {DashboardSummary} from "@/app/sites/dashboard-actions";
const {summary, activity, countRead} = vi.hoisted(() => ({summary:vi.fn(),activity:vi.fn(),countRead:vi.fn()}));
vi.mock("@/app/sites/dashboard-actions", () => ({getSiteDashboardSummary:(...args:unknown[]) => summary(...args),getSiteDashboardActivity:(...args:unknown[]) => activity(...args)}));
vi.mock("next/navigation", () => ({useRouter:()=>({push:vi.fn()}),usePathname:()=>"/sites/11/admin"}));
vi.mock("next/link",()=>({default:({href,children,...props}:React.ComponentProps<"a"> & {href:string})=><a href={href} {...props}>{children}</a>}));
const site={id:11,name:"Informatics",code:"INFORMATICS",status:"ACTIVE" as const};
const all=["content.pages.view","content.pages.create","content.posts.view","menu.read","menu.write","content.media.view","platform.users.view"];
const modules=["PAGES","POSTS","MENUS","MEDIA"];
function body():DashboardSummary {return {schema_version:1,site:11,generated_at:new Date().toISOString(),expires_at:new Date(Date.now()+15000).toISOString(),partial:false,cache:{hit:false,available:true,ttl_seconds:15},sections:{
 pages:{status:"ready",counts:{total:8,DRAFT:2,IN_REVIEW:1,APPROVED:0,PUBLISHED:4,UNPUBLISHED:0,ARCHIVED:1}},
 posts:{status:"ready",counts:{total:5,DRAFT:1,IN_REVIEW:1,APPROVED:0,PUBLISHED:3,UNPUBLISHED:0,ARCHIVED:0}},
 menus:{status:"ready",counts:{total:2,active:1,items:3}},media:{status:"ready",counts:{total:80}},users:{status:"ready",counts:{total:1}}}};}
function dashboard(enabled=modules, permissions=all, extra?:React.ReactNode) {return render(<SiteAdminFrame site={site} enabledModuleCodes={enabled} permissions={permissions}><SiteDashboard/>{extra}</SiteAdminFrame>);}
beforeEach(()=>{vi.clearAllMocks();summary.mockResolvedValue({ok:true,data:body()});activity.mockResolvedValue({ok:true,data:{site:11,generated_at:new Date().toISOString(),results:[]}});});
it("renders five domains using one aggregate request without list fan-out",async()=>{
 dashboard();const pages=await screen.findByRole("region",{name:"Pages"});await waitFor(()=>expect(within(pages).getByText("8")).toBeTruthy());
 expect(within(screen.getByRole("region",{name:"Posts"})).getByText("5")).toBeTruthy();expect(within(screen.getByRole("region",{name:"Menus"})).getByText("3")).toBeTruthy();expect(within(screen.getByRole("region",{name:"Media"})).getByText("80")).toBeTruthy();
 expect(summary).toHaveBeenCalledTimes(1);expect(summary).toHaveBeenCalledWith(11);
});
it("shows essentials while a secondary widget is slow or fails",async()=>{
 let fail!:(value:unknown)=>void;activity.mockImplementationOnce(()=>new Promise(resolve=>{fail=resolve;}));dashboard();
 await screen.findByText(/Loading recent activity/);expect(within(screen.getByRole("region",{name:"Pages"})).getByText("8")).toBeTruthy();
 await act(async()=>fail({ok:false,error:{status:503,code:"unavailable",message:"Slow provider",details:null,requestId:null}}));
 await screen.findByText("Recent activity is unavailable. Summary counts remain available.");expect(within(screen.getByRole("region",{name:"Pages"})).getByText("8")).toBeTruthy();
});
it("isolates one failed aggregate without showing a false zero",async()=>{
 const data=body();data.partial=true;data.sections.posts={status:"unavailable"};summary.mockResolvedValueOnce({ok:true,data});dashboard();
 await screen.findByText(/Posts could not be summarized/);expect(within(screen.getByRole("region",{name:"Pages"})).getByText("8")).toBeTruthy();expect(within(screen.getByRole("region",{name:"Posts"})).queryByText("0")).toBeNull();
});
it("retains prior values on transient refresh error and retries without blanking",async()=>{
 dashboard(["PAGES"],["content.pages.view"]);await screen.findByText("8");
 summary.mockResolvedValueOnce({ok:false,error:{status:503,code:"unavailable",message:"Outage",details:null,requestId:null}});
 act(()=>{unwrap({ok:true,data:{},invalidation:{site:11,domain:"pages"}});});
 await screen.findByText("Refresh failed. Previously loaded totals are shown.");expect(screen.getByText("8")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Retry summary"}));await waitFor(()=>expect(screen.queryByText("Refresh failed. Previously loaded totals are shown.")).toBeNull());
});
it("hides cached protected counts after a scope-level 404",async()=>{
 dashboard(["PAGES"],["content.pages.view"]);await screen.findByText("8");summary.mockResolvedValueOnce({ok:false,error:{status:404,code:"not_found",message:"Unavailable Site",details:null,requestId:null}});
 act(()=>{unwrap({ok:true,data:{},invalidation:{site:11,domain:"pages"}});});await screen.findByText(/Pages could not be summarized: Unavailable Site/);expect(screen.queryByText("8")).toBeNull();
});
it("primes the canonical Page status query for a later section without another read",async()=>{
 function Counts(){const state=useSiteQuery(11,"page-counts",{},countRead);return <p>{state.data?"Counts ready":"Waiting"}</p>;}
 function Later(){const[open,show]=useState(false);return <><button onClick={()=>show(true)}>Open counts</button>{open?<Counts/>:null}</>;}
 dashboard(["PAGES"],["content.pages.view"],<Later/>);await screen.findByText("8");fireEvent.click(screen.getByText("Open counts"));await screen.findByText("Counts ready");expect(countRead).not.toHaveBeenCalled();
});
it("omits disabled/unauthorized cards while preserving permission-aware quick actions",async()=>{
 dashboard(["PAGES"],["content.pages.view","content.pages.create","content.posts.view"]);expect(screen.getByRole("link",{name:"Create page"}).getAttribute("href")).toBe("/sites/11/admin/pages/new");await screen.findByText("8");expect(screen.queryByRole("region",{name:"Posts"})).toBeNull();expect(screen.getByText(/Not enabled for this Site: Posts/)).toBeTruthy();
});
it("shows intentional empty data and a cache timestamp",async()=>{
 const data=body();data.cache.hit=true;data.sections.pages!.counts={total:0,DRAFT:0,IN_REVIEW:0,APPROVED:0,PUBLISHED:0,UNPUBLISHED:0,ARCHIVED:0};summary.mockResolvedValueOnce({ok:true,data});dashboard(["PAGES"],["content.pages.view"]);await screen.findByText("This Site has no Pages yet.");expect(screen.getByText(/Cached/)).toBeTruthy();expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(data.generated_at);
});
it("handles a Site with no available modules",()=>{dashboard([],[]);expect(screen.getByText("No content modules are available to you for this Site.")).toBeTruthy();});

it("retains a permitted create action without exposing view-only counters",()=>{dashboard(["PAGES"],["content.pages.create"]);expect(screen.getByRole("link",{name:"Create page"})).toBeTruthy();expect(screen.queryByRole("region",{name:"Pages"})).toBeNull();});

it("purges other cached views when a live summary reveals a removed read grant",async()=>{
 let client:ReturnType<typeof useQueryEnvironment>["client"];
 function Cached(){const env=useQueryEnvironment();client=env.client;client.setQueryData(queryKey({...env,siteId:11},"pages"),{secret:"Previously allowed"});return null;}
 dashboard(["PAGES"],["content.pages.view"],<Cached/>);await screen.findByText("8");
 const data=body();delete data.sections.pages;summary.mockResolvedValueOnce({ok:true,data});
 act(()=>{unwrap({ok:true,data:{},invalidation:{site:11,domain:"pages"}});});
 await screen.findByText(/Pages could not be summarized/);
 expect(client!.getQueryCache().getAll().some(query=>query.queryKey[4]==="pages")).toBe(false);
});
