import {cleanup,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const context=vi.hoisted(()=>({site:{id:17,displayName:"Main",modules:{pages:true}}}));
vi.mock("@uog/ui",async()=>({...await vi.importActual<typeof import("@uog/ui")>("@uog/ui"),usePublicSiteBranding:()=>context.site}));
import HomePage from "../../../public-web/src/app/page";
const page=(site=17,title="Main published")=>({site,title,status:"PUBLISHED",path:"/",blocks:[]});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
beforeEach(()=>{context.site={id:17,displayName:"Main",modules:{pages:true}};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("renders published content without operational diagnostics or extra health calls",async()=>{
 const read=vi.fn().mockResolvedValue(response(page()));vi.stubGlobal("fetch",read);render(<HomePage/>);
 await screen.findByRole("heading",{name:"Main published"});expect(read).toHaveBeenCalledTimes(1);
 expect(read.mock.calls[0]?.[0]).toBe("/api/v1/site-context/homepage/");expect(read.mock.calls[0]?.[1]).toMatchObject({cache:"no-store",headers:{Accept:"application/json"}});expect(read.mock.calls[0]?.[1]?.headers?.Authorization).toBeUndefined();
 expect(screen.queryByText(/Backend readiness|Site resolved from this host|PostgreSQL/)).toBeNull();
});
it("does not render foreign or draft content and does not fetch when Pages is disabled",async()=>{
 for(const body of [page(22,"Private foreign"),{...page(17,"Private draft"),status:"DRAFT"}]){
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(body)));const view=render(<HomePage/>);
  await waitFor(()=>expect(screen.queryByText("Loading homepage...")).toBeNull());expect(screen.queryByRole("heading",{name:/Private/})).toBeNull();view.unmount();
 }
 context.site={...context.site,modules:{pages:false}};const read=vi.fn();vi.stubGlobal("fetch",read);render(<HomePage/>);expect(read).not.toHaveBeenCalled();
});
it("aborts an obsolete Site read and ignores its late result",async()=>{
 let resolveOld!:(value:Response)=>void;
 const read=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{resolveOld=r;})).mockResolvedValueOnce(response(page(22,"Current Site")));
 vi.stubGlobal("fetch",read);const view=render(<HomePage/>);const oldSignal=read.mock.calls[0]?.[1]?.signal as AbortSignal;
 context.site={...context.site,id:22};view.rerender(<HomePage/>);await screen.findByRole("heading",{name:"Current Site"});expect(oldSignal.aborted).toBe(true);
 resolveOld(response(page(17,"Obsolete private")));await waitFor(()=>expect(screen.queryByRole("heading",{name:"Obsolete private"})).toBeNull());
});
it("provides a recoverable error for a failed homepage read",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({},503)));render(<HomePage/>);await screen.findByText("The homepage is temporarily unavailable.");expect(screen.getByRole("button",{name:"Retry"})).toBeTruthy();
});

it("distinguishes an unresolved hostname from a Site with no published homepage",()=>{
 context.site={...context.site,id:0};const read=vi.fn();vi.stubGlobal("fetch",read);render(<HomePage/>);
 expect(screen.getByRole("alert").textContent).toContain("No Site is configured for this hostname.");
 expect(screen.queryByText("This Site has no published page to show.")).toBeNull();expect(read).not.toHaveBeenCalled();
});
