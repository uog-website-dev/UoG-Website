import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {SiteAppearancePanel} from "./site-appearance";
const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),site:{id:16,name:"Informatics"}}));
vi.mock("@/app/sites/actions",()=>({getSite:mocks.get,updateSiteConfiguration:mocks.save}));
vi.mock("./site-admin-frame",()=>({useSiteAdmin:()=>({site:mocks.site})}));
vi.mock("./site-image-field",()=>({SiteImageField:({onChange}:{onChange:(value:{assetId:string;alt:string})=>void})=><button type="button" onClick={()=>onChange({assetId:"00000000-0000-4000-8000-000000000001",alt:"Logo"})}>Choose Site logo</button>}));
const config={identity:{display_name:"College name",logo_ref:null},presentation:{theme:"institutional"}};
const loaded=(id=16,title="College name",etag='"original"')=>({ok:true,data:{data:{id,configuration:{...config,identity:{...config.identity,display_name:title}}},etag}});
beforeEach(()=>{mocks.site={id:16,name:"Informatics"};mocks.get.mockReset().mockResolvedValue(loaded());mocks.save.mockReset();});
it("saves only Site appearance with the loaded ETag and reopens effective settings",async()=>{
 mocks.save.mockResolvedValue(loaded(16,"New public title",'"saved"'));
 const view=render(<SiteAppearancePanel/>);
 const title=await screen.findByRole("textbox",{name:"Public Site title"});
 fireEvent.change(title,{target:{value:"New public title"}});
 fireEvent.click(screen.getByRole("button",{name:"Choose Site logo"}));
 fireEvent.click(screen.getByRole("button",{name:"Save appearance"}));
 await screen.findByText(/Appearance saved for this Site/);
 expect(mocks.save).toHaveBeenCalledWith(16,'"original"',{identity:{display_name:"New public title",logo_ref:"00000000-0000-4000-8000-000000000001"},presentation:{theme:"institutional"}});
 view.unmount();mocks.get.mockResolvedValue(loaded(16,"New public title",'"saved"'));render(<SiteAppearancePanel/>);
 expect((await screen.findByRole("textbox",{name:"Public Site title"}) as HTMLInputElement).value).toBe("New public title");
});
it("preserves unsaved text and reports a stale-write conflict",async()=>{
 mocks.save.mockResolvedValue({ok:false,error:{status:412,code:"precondition_failed",message:"Changed",details:null,requestId:null}});
 render(<SiteAppearancePanel/>);const title=await screen.findByRole("textbox",{name:"Public Site title"});
 fireEvent.change(title,{target:{value:"Unsaved work"}});fireEvent.click(screen.getByRole("button",{name:"Save appearance"}));
 await screen.findByText(/Appearance changed in another session/);expect((title as HTMLInputElement).value).toBe("Unsaved work");
});
it("retries a failed read without displaying an empty editable form",async()=>{
 mocks.get.mockRejectedValueOnce(new Error("Transport failure"));render(<SiteAppearancePanel/>);
 await screen.findByText("Transport failure");expect(screen.queryByRole("textbox")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Retry"}));await screen.findByRole("textbox",{name:"Public Site title"});
});
it("clears Site A edits and ignores its delayed response after a Site switch",async()=>{
 let finish!:(value:unknown)=>void;mocks.get.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const {rerender}=render(<SiteAppearancePanel/>);mocks.site={id:19,name:"Other college"};mocks.get.mockResolvedValue(loaded(19,"Other title"));rerender(<SiteAppearancePanel/>);
 await screen.findByDisplayValue("Other title");finish(loaded(16,"Late foreign title"));
 await waitFor(()=>expect(screen.queryByDisplayValue("Late foreign title")).toBeNull());
});
