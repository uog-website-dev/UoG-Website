import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {SiteHeaderEnvelope} from "@/app/sites/header-actions";

const actions=vi.hoisted(()=>({getSiteHeader:vi.fn(),updateSiteHeader:vi.fn(),publishSiteHeader:vi.fn(),restorePreviousSiteHeader:vi.fn()}));
vi.mock("@/app/sites/header-actions",()=>actions);
vi.mock("./site-admin-frame",()=>({useSiteAdmin:()=>({site:{id:4,name:"Informatics"},enabledModuleCodes:["MENUS","PAGES"]})}));
vi.mock("./site-draft-guard",()=>({useSiteDraftGuard:()=>{}}));

import {SiteHeaderPanel} from "./site-header-panel";

const envelope:SiteHeaderEnvelope={
 site:4,version:1,
 settings:{brand_href:"/",search_enabled:true,sticky:false,brand_quote:"",cta_label:"",cta_url:"",language_switcher:false},
 published_settings:{brand_href:"/",search_enabled:true,sticky:false,brand_quote:"",cta_label:"",cta_url:"",language_switcher:false},
 has_unpublished_changes:false,published_at:null,previous_available:false,
 menus:{header:[{label:"About",href:"/about"}],utility:[]},
 menu_state:{header:{published:"Main",draft:"Main",is_published:true,has_changes:false},utility:{published:null,draft:null,is_published:false,has_changes:false}},
 site_origin:null,modules:["MENUS","PAGES"],
 branding:{name:"Informatics",theme:"institutional",logo_asset_id:null},
};

afterEach(()=>{cleanup();vi.clearAllMocks();});

async function open(){
 actions.getSiteHeader.mockResolvedValue({ok:true,data:{data:envelope,etag:'"site-header-4-v1"'}});
 render(<SiteHeaderPanel/>);
 await screen.findByRole("heading",{name:"Header"});
 await waitFor(()=>expect(screen.getByText("Header menu:")).toBeTruthy());
}

describe("SiteHeaderPanel",()=>{
 it("previews the real public header with published menus and a mobile viewport",async()=>{
  await open();
  const preview=screen.getByRole("region",{name:"Header preview"});
  expect(preview.querySelector('[data-site-header="4"]')).toBeTruthy();
  expect(screen.getByRole("link",{name:"About"})).toBeTruthy();
  const mobile=screen.getByRole("button",{name:"Mobile"});
  fireEvent.click(mobile);
  expect(mobile.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button",{name:"Desktop"}).getAttribute("aria-pressed")).toBe("false");
 });

 it("shows backend field errors and does not report a save",async()=>{
  await open();
  actions.updateSiteHeader.mockResolvedValue({ok:false,error:{status:400,code:"validation_error",message:"Invalid header settings.",details:{fields:{cta_url:["Use a same-site path or an https URL."]}},requestId:null}});
  fireEvent.change(screen.getByLabelText("Button label"),{target:{value:"Apply now"}});
  fireEvent.change(screen.getByLabelText("Button destination"),{target:{value:"javascript:alert(1)"}});
  fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
  await screen.findByText("Use a same-site path or an https URL.");
  expect(screen.queryByText(/draft saved/)).toBeNull();
 });

 it("saves a draft without claiming it is public",async()=>{
  await open();
  actions.updateSiteHeader.mockResolvedValue({ok:true,data:{data:{...envelope,version:2,has_unpublished_changes:true,settings:{...envelope.settings,sticky:true}},etag:'"site-header-4-v2"'}});
  fireEvent.click(screen.getByLabelText("Keep the header visible while scrolling"));
  fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
  await screen.findByText(/Header draft saved\. Nothing is public until you publish it/);
  expect(actions.updateSiteHeader.mock.calls[0][2].sticky).toBe(true);
 });

 it("previews and saves the plain-text quote beneath the Site name",async()=>{
  await open();
  const quote="Knowledge serves humanity.";
  fireEvent.change(screen.getByLabelText("Quote beneath Site name"),{target:{value:quote}});
  const preview=screen.getByRole("region",{name:"Header preview"});
  expect(preview.querySelector("[data-site-branding-quote]")?.textContent).toBe(quote);
  actions.updateSiteHeader.mockResolvedValue({ok:true,data:{data:{...envelope,version:2,has_unpublished_changes:true,settings:{...envelope.settings,brand_quote:quote}},etag:'"site-header-4-v2"'}});
  fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
  await screen.findByText(/Header draft saved\. Nothing is public until you publish it/);
  expect(actions.updateSiteHeader.mock.calls[0][2].brand_quote).toBe(quote);
 });

 it("publishes saved values and restores the previous publication into the draft",async()=>{
  await open();
  actions.publishSiteHeader.mockResolvedValue({ok:true,data:{data:{...envelope,version:2,published_at:"2026-11-23T10:00:00Z",previous_available:true},etag:'"site-header-4-v2"'}});
  vi.spyOn(window,"confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button",{name:"Publish header"}));
  await screen.findByText(/Header published\. Visitors now see these values/);
  expect(actions.publishSiteHeader).toHaveBeenCalledWith(4,'"site-header-4-v1"');
  actions.restorePreviousSiteHeader.mockResolvedValue({ok:true,data:{data:{...envelope,version:3,previous_available:true},etag:'"site-header-4-v3"'}});
  fireEvent.click(screen.getByRole("button",{name:"Restore previous published header"}));
  await screen.findByText(/Previous published header restored into the draft/);
  expect(actions.restorePreviousSiteHeader).toHaveBeenCalledWith(4,'"site-header-4-v2"');
 });
});
