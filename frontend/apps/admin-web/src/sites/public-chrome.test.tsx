import {cleanup,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {EMPTY_SITE,PublicSiteBrandingProvider} from "@uog/ui";
import {PublicMenus} from "../../../public-web/src/public-menus";
const site={...EMPTY_SITE,id:16,displayName:"College of Informatics",modules:{...EMPTY_SITE.modules,menus:true}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("places scoped navigation inside one branded header and footer",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({site:16,locations:{header:[{label:"About",href:"/about"}],footer:[{label:"Contact",href:"/contact"}]}}))));
 render(<PublicSiteBrandingProvider site={site}><PublicMenus><p>Published content</p></PublicMenus></PublicSiteBrandingProvider>);
 const header=screen.getByRole("banner");
 await waitFor(()=>expect(within(header).getByRole("link",{name:"About"})).toBeTruthy());
 expect(within(header).getByRole("link",{name:/College of Informatics/}).getAttribute("href")).toBe("/");
 expect(within(screen.getByRole("contentinfo")).getByRole("link",{name:"Contact"})).toBeTruthy();
 expect(within(screen.getByRole("main")).getByText("Published content")).toBeTruthy();
});
it("immediately removes old navigation on Site change and skips disabled menu reads",async()=>{
 const read=vi.fn().mockResolvedValue(new Response(JSON.stringify({site:16,locations:{header:[{label:"Former Site link",href:"/old"}]}})));vi.stubGlobal("fetch",read);
 const view=(current:typeof site)=><PublicSiteBrandingProvider site={current}><PublicMenus><p>Content</p></PublicMenus></PublicSiteBrandingProvider>;
 const {rerender}=render(view(site));await screen.findByRole("link",{name:"Former Site link"});
 rerender(view({...site,id:19,displayName:"Other Site",modules:{...site.modules,menus:false}}));
 expect(screen.queryByRole("link",{name:"Former Site link"})).toBeNull();expect(read).toHaveBeenCalledTimes(1);
});
