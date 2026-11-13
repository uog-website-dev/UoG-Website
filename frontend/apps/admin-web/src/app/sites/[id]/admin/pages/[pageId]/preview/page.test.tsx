import {render,screen,waitFor} from "@testing-library/react";
import {beforeEach,it,expect,vi} from "vitest";
const {load,context,query}=vi.hoisted(()=>({load:vi.fn(),context:{site:{id:11},permissions:["content.pages.view"]},query:{revision:"8"}}));
vi.mock("next/navigation",()=>({useParams:()=>({pageId:"00000000-0000-4000-8000-000000000001"}),useSearchParams:()=>new URLSearchParams(query)}));
vi.mock("next/link",()=>({default:({href,children}:React.ComponentProps<"a">)=><a href={href}>{children}</a>}));
vi.mock("@/sites/site-admin-frame",()=>({useSiteAdmin:()=>context,SiteSection:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock("@/app/sites/page-actions",()=>({getSitePagePreview:load}));
import PagePreview from "./page";
beforeEach(()=>{
  context.permissions=["content.pages.view"];query.revision="8";load.mockReset();
  load.mockResolvedValue({ok:true,data:{revision_number:8,page:{id:"00000000-0000-4000-8000-000000000001",site:11,title:"Reviewed Page",path:"/home",blocks:[{type:"image",ref:"sites/11/assets/00000000-0000-4000-8000-000000000002",alt:"Campus"}],seo:{}}}});
});
it("opens the requested saved revision across the full preview surface",async()=>{
  render(<PagePreview/>);
  expect(await screen.findByRole("img",{name:"Campus"})).toHaveProperty("src",expect.stringContaining("/preview-media/8/"));
  expect(load).toHaveBeenCalledWith(11,"00000000-0000-4000-8000-000000000001",8);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading",{level:1,name:"Reviewed Page"})).toBeTruthy();
});
it("rejects an invalid revision before requesting content",async()=>{
  query.revision="-1";render(<PagePreview/>);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("invalid"));
  expect(load).not.toHaveBeenCalled();
});
it("requires preview permission and rejects foreign Site content",async()=>{
  context.permissions=[];const view=render(<PagePreview/>);
  await screen.findByRole("alert");expect(load).not.toHaveBeenCalled();view.unmount();
  context.permissions=["content.pages.view"];
  load.mockResolvedValue({ok:true,data:{page:{site:22,title:"Foreign"}}});
  render(<PagePreview/>);
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("another Site"));
  expect(screen.queryByText("Foreign")).toBeNull();
});
