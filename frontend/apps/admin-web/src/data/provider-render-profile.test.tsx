import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {memo,Profiler,useState} from "react";
import {act,fireEvent,render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {SiteAdminFrame,useSiteAdmin} from "@/sites/site-admin-frame";
import {QueryScope,useQueryEnvironment,AuthorizationScope} from "./query-cache";
vi.mock("next/navigation",()=>({usePathname:()=>"/sites/11/admin",useRouter:()=>({push:vi.fn(),replace:vi.fn()})}));
vi.mock("next/link",()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}));
const site={id:11,name:"Informatics",code:"INFO",status:"ACTIVE" as const},permissions=["sites.view"],modules=["PAGES"];
const budget=JSON.parse(readFileSync(resolve(process.cwd(),"../../scripts/perf/bundle-budgets.json"),"utf8")).render_profile as {unrelated_parent_updates:number;max_consumer_renders:number};
it.each(['site-frame','query-scope','authorization-scope'])("profiles context consumers across unrelated parent updates: %s",kind=>{
 let renders=0;const commits:number[]=[],renderDurations:number[]=[];
 const Probe=memo(function Probe(){const started=performance.now();if(kind==='site-frame')useSiteAdmin();else useQueryEnvironment();renders++;renderDurations.push(performance.now()-started);return <span>Scope consumer</span>;});
 const child=<Profiler id={kind} onRender={(_id,_phase,duration)=>commits.push(duration)}><Probe/></Profiler>;
 function Parent(){const[count,setCount]=useState(0);return <><button onClick={()=>setCount(v=>v+1)}>Unrelated {count}</button>{kind==='site-frame'?<SiteAdminFrame site={site} permissions={permissions} enabledModuleCodes={modules}>{child}</SiteAdminFrame>:<QueryScope identity="profile-session" siteId={11} authorization="editor">{kind==='authorization-scope'?<AuthorizationScope authorization="editor-v2">{child}</AuthorizationScope>:child}</QueryScope>}</>;}
 render(<Parent/>);for(let i=0;i<budget.unrelated_parent_updates;i++)act(()=>fireEvent.click(screen.getByRole('button',{name:`Unrelated ${i}`})));
 console.info(JSON.stringify({event:'uog.provider.profile',kind,parent_updates:budget.unrelated_parent_updates,consumer_renders:renders,consumer_render_ms:renderDurations.reduce((a,b)=>a+b,0),profiler_commits:commits.length,profiler_duration_ms:commits.reduce((a,b)=>a+b,0)}));
 expect(renders).toBe(budget.max_consumer_renders);
});
