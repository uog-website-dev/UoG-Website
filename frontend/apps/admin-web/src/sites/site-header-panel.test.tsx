import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {SiteHeaderEnvelope} from "@/app/sites/header-actions";

vi.mock("@/app/sites/header-actions",()=>({getSiteHeader:vi.fn(),updateSiteHeader:vi.fn()}));
vi.mock("./site-admin-frame",()=>({useSiteAdmin:()=>({site:{id:4,name:"Informatics"},enabledModuleCodes:["MENUS","PAGES"]})}));
vi.mock("./site-draft-guard",()=>({useSiteDraftGuard:()=>{}}));

import {getSiteHeader,updateSiteHeader} from "@/app/sites/header-actions";
import {SiteHeaderPanel} from "./site-header-panel";

const envelope:SiteHeaderEnvelope={
 site:4,version:1,
 settings:{brand_href:"/",search_enabled:true,sticky:false,cta_label:"",cta_url:"",language_switcher:false},
 menus:{header:[{label:"About",href:"/about"}],utility:[]},
 menu_state:{header:{published:"Main",draft:"Main",is_published:true,has_changes:false},utility:{published:null,draft:null,is_published:false,has_changes:false}},
 site_origin:null,modules:["MENUS","PAGES"],
 branding:{name:"Informatics",theme:"institutional",logo_asset_id:null},
};

afterEach(()=>{cleanup();vi.clearAllMocks();});

async function open(){
 vi.mocked(getSiteHeader).mockResolvedValue({ok:true,data:{data:envelope,etag:'"site-header-4-v1"'}});
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
  vi.mocked(updateSiteHeader).mockResolvedValue({ok:false,error:{status:400,code:"validation_error",message:"Invalid header settings.",details:{fields:{cta_url:["Use a same-site path or an https URL."]}},requestId:null}});
  fireEvent.change(screen.getByLabelText("Button label"),{target:{value:"Apply now"}});
  fireEvent.change(screen.getByLabelText("Button destination"),{target:{value:"javascript:alert(1)"}});
  fireEvent.click(screen.getByRole("button",{name:"Save header"}));
  await screen.findByText("Use a same-site path or an https URL.");
  expect(screen.queryByText(/Header saved for this Site/)).toBeNull();
 });

 it("confirms the published save action",async()=>{
  await open();
  vi.mocked(updateSiteHeader).mockResolvedValue({ok:true,data:{data:{...envelope,version:2,settings:{...envelope.settings,sticky:true}},etag:'"site-header-4-v2"'}});
  fireEvent.click(screen.getByLabelText("Keep the header visible while scrolling"));
  fireEvent.click(screen.getByRole("button",{name:"Save header"}));
  await screen.findByText(/Header saved for this Site/);
  expect(vi.mocked(updateSiteHeader).mock.calls[0][2].sticky).toBe(true);
 });
});
