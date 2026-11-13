import {fireEvent,render,screen,waitFor,within,act} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,it,expect,vi} from "vitest";
import type {SitePageRecord} from "@/app/sites/page-actions";
import type {ActionResult} from "@/organizations/contract";
import {starterLayout} from "./visual-builder-model";

const {load,save,open,push,preview,transition,listTemplates,createTemplate,insertTemplate}=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),open:vi.fn(),push:vi.fn(),preview:vi.fn(),transition:vi.fn(),listTemplates:vi.fn(),createTemplate:vi.fn(),insertTemplate:vi.fn()}));
vi.mock("@/app/sites/page-actions",()=>({
  getSiteVisualDraft:load,saveSiteVisualDraft:save,openWorkingDraft:open,
  getSitePagePreview:preview,transitionSitePage:transition,
  listSiteSectionTemplates:listTemplates,createSiteSectionTemplate:createTemplate,insertSiteSectionTemplate:insertTemplate,
}));
vi.mock("next/navigation",()=>({useRouter:()=>({push}),usePathname:()=>"/sites/11/admin/pages",useParams:()=>({pageId:"00000000-0000-4000-8000-000000000001"})}));
vi.mock("next/link",()=>({default:({children,href,...props}:React.ComponentProps<"a">)=><a href={href} {...props}>{children}</a>}));
vi.mock("@/sites/media-picker",()=>({MediaPickerDialog:()=>null}));
import {VisualBuilder} from "./visual-builder";
import VisualBuilderPage from "@/app/sites/[id]/admin/pages/[pageId]/builder/page";
import {SiteAdminFrame} from "./site-admin-frame";

const id="00000000-0000-4000-8000-000000000001";
const other="00000000-0000-4000-8000-000000000002";
const props={siteId:11,siteName:"Informatics",pageId:id,builderEnabled:true,permissions:["content.pages.view","content.pages.update"]};
function record(values:Partial<SitePageRecord>={}):SitePageRecord{return {
  id,site:11,title:"Admissions",slug:"admissions",path:"/admissions",parent:null,status:"DRAFT",visibility:"PUBLIC",locale:"en-us",is_homepage:false,created_by:7,
  updated_at:"2026-11-12T00:00:00Z",blocks:[],seo:{},metadata:{visual_layout:{schema_version:1,rows:[]}},etag:'"revision-1"',revision_number:1,available_actions:["submit"],...values,
};}
const fail=(status:number)=>({ok:false,error:{status,code:"api_error",message:"Request failed.",details:null,requestId:null}});
beforeEach(()=>{vi.clearAllMocks();load.mockResolvedValue({ok:true,data:record()});save.mockResolvedValue({ok:true,data:record({etag:'"revision-2"',revision_number:2})});preview.mockResolvedValue({ok:true,data:{revision_id:1,revision_number:1,content_hash:"abc",status:"DRAFT",approval_id:null,reviewed_revision_id:null,approved_revision_id:null,page:{title:"Admissions",path:"/admissions",site:11,blocks:[],metadata:{},seo:{}},etag:'"preview-1"'}});transition.mockResolvedValue({ok:true,data:record({status:"IN_REVIEW",etag:'"revision-3"',revision_number:3,available_actions:["approve","reject"]})});listTemplates.mockResolvedValue({ok:true,data:[]});createTemplate.mockResolvedValue({ok:true,data:{id:"tmpl-1",site:11,name:"Band",status:"ACTIVE",schema_version:1,version:1,section:{id:"row",type:"section",ratios:[100],columns:[]},created_at:"2026-11-12T00:00:00Z",updated_at:"2026-11-12T00:00:00Z"}});insertTemplate.mockResolvedValue({ok:true,data:record({etag:'"revision-2"',revision_number:2})});});

describe("Visual Builder workspace",()=>{
  it("keeps the selected device layout width while fitting a narrow workspace",async()=>{
    const clientWidth=vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(640);
    vi.stubGlobal("ResizeObserver",class { observe(){} disconnect(){} });
    try {
      load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
      const user=userEvent.setup();
      render(<VisualBuilder {...props}/>);
      const canvas=await screen.findByRole("region",{name:"Live Page canvas"});
      await waitFor(()=>expect(getComputedStyle(canvas).width).toBe("1280px"));
      expect(canvas.getAttribute("data-preview-scale")).toBe("0.5");
      await user.click(screen.getByRole("button",{name:"Mobile"}));
      await waitFor(()=>expect(getComputedStyle(canvas).width).toBe("390px"));
      expect(canvas.getAttribute("data-preview-scale")).toBe("1");
    } finally {
      clientWidth.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("mounts the actual Page route inside Site Administration and guards disabled/view-only direct navigation",async()=>{
    const site={id:11,name:"Informatics",code:"CI",status:"ACTIVE" as const};
    const view=render(<SiteAdminFrame site={site} enabledModuleCodes={[]} permissions={props.permissions}><VisualBuilderPage/></SiteAdminFrame>);
    expect(screen.getByText("Visual Builder is not enabled for this Site.")).toBeTruthy();
    view.rerender(<SiteAdminFrame site={site} enabledModuleCodes={["PAGES"]} permissions={props.permissions}><VisualBuilderPage/></SiteAdminFrame>);
    expect(screen.getByText("Visual Builder is not enabled for this Site.")).toBeTruthy();
    view.rerender(<SiteAdminFrame site={site} enabledModuleCodes={["VISUAL_BUILDER"]} permissions={["content.pages.view"]}><VisualBuilderPage/></SiteAdminFrame>);
    expect(screen.getByText(/do not have permission to open Visual Builder/)).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    view.rerender(<SiteAdminFrame site={site} enabledModuleCodes={["VISUAL_BUILDER"]} permissions={props.permissions}><VisualBuilderPage/></SiteAdminFrame>);
    expect(await screen.findByRole("heading",{name:"Admissions"})).toBeTruthy();
    expect(load).toHaveBeenCalledWith(11,id);
  });
  it("blocks unavailable, disabled, unauthorized and invalid direct contexts before loading a Page",()=>{
    const view=render(<VisualBuilder {...props} builderEnabled={null}/>);
    expect(screen.getByRole("status").textContent).toContain("availability");
    view.rerender(<VisualBuilder {...props} builderEnabled={false}/>);
    expect(screen.getByRole("alert").textContent).toContain("disabled");
    view.rerender(<VisualBuilder {...props} permissions={["content.pages.view"]}/>);
    expect(screen.getByRole("alert").textContent).toContain("do not have access");
    view.rerender(<VisualBuilder {...props} pageId="bad-id"/>);
    expect(screen.getByRole("alert").textContent).toContain("invalid");
    expect(load).not.toHaveBeenCalled();
  });
  it("renders loading, empty and initial keyboard focus with explicit Page and Site context",async()=>{
    render(<VisualBuilder {...props}/>);
    expect(screen.getByRole("status").textContent).toContain("Loading Visual Builder");
    expect(await screen.findByText("Start composing your Page")).toBeTruthy();
    const title=screen.getByRole("heading",{name:"Admissions"});
    await waitFor(()=>expect(document.activeElement).toBe(title));
    expect(screen.getByText("Informatics · Revision 1 · DRAFT")).toBeTruthy();
    expect((screen.getByRole("button",{name:"Save draft"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("searches the 43-card picker, supports arrow/Enter selection and restores invoking focus",async()=>{
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Add your first row"}));
    await user.click(screen.getByText("Row layout controls"));
    const trigger=screen.getByRole("button",{name:"Add widget to row 1 column 1"});
    await user.click(trigger);
    const dialog=await screen.findByRole("dialog",{name:/Choose a widget/});
    expect(within(dialog).getByRole("button",{name:"All (43)"})).toBeTruthy();
    await user.type(within(dialog).getByRole("textbox",{name:"Search widgets"}),"Slider");
    expect(within(dialog).getByRole("button",{name:"Media & sliders (2)"})).toBeTruthy();
    const image=within(dialog).getByRole("button",{name:/Image Slider Media & sliders/});
    image.focus();await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toContain("Layout Slider");
    await user.keyboard("{Enter}");
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(()=>expect(document.activeElement).toBe(trigger));
    await user.click(screen.getByRole("tab",{name:"Structure"}));
    const outline=screen.getByRole("navigation",{name:"Nested layout outline"});
    await user.click(within(outline).getByRole("button",{name:/Select Headline/}));
    expect((within(screen.getByRole("complementary",{name:"Widget inspector"})).getByRole("textbox",{name:"Text"}) as HTMLInputElement).value).toBe("Slide headline");
  });
  it("provides a meaningful empty palette search and Escape restores focus",async()=>{
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Add your first row"}));
    await user.click(screen.getByText("Row layout controls"));
    const trigger=screen.getByRole("button",{name:"Add widget to row 1 column 1"});await user.click(trigger);
    const dialog=await screen.findByRole("dialog",{name:/Choose a widget/});
    await user.type(within(dialog).getByRole("textbox",{name:"Search widgets"}),"not-a-widget");
    expect(within(dialog).getByText("No widgets match your search.")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(()=>expect(document.activeElement).toBe(trigger));
  });
  it("exposes Widgets and Structure docks with canvas viewport chrome",async()=>{
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await screen.findByRole("heading",{name:"Admissions"});
    expect(screen.getByRole("tab",{name:"Widgets",selected:true})).toBeTruthy();
    expect(screen.getByRole("group",{name:"Canvas viewport"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Desktop",pressed:true})).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Tablet"}));
    expect(screen.getByRole("button",{name:"Tablet",pressed:true})).toBeTruthy();
    await user.click(screen.getByRole("tab",{name:"Structure"}));
    expect(screen.getByRole("navigation",{name:"Nested layout outline"})).toBeTruthy();
    await user.click(screen.getByRole("tab",{name:"Widgets"}));
    expect(screen.getByRole("textbox",{name:"Search widgets"})).toBeTruthy();
  });
  it("saves the complete valid tree with the last loaded ETag and reports conflicts without losing edits",async()=>{
    save.mockResolvedValue(fail(409));const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    await user.click(screen.getByRole("button",{name:"Save draft"}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith(11,id,'"revision-1"',expect.objectContaining({schema_version:1,rows:expect.any(Array)})));
    expect(await screen.findByText(/A newer draft was saved elsewhere/)).toBeTruthy();
    expect(screen.getByText("Welcome to your Site")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button",{name:"Reload server draft"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Adopt server draft"})).toBeTruthy();
  });
  it("keeps local edits on conflict and lets Reload refresh the ETag for reconciliation",async()=>{
    save.mockResolvedValueOnce(fail(409));
    load.mockResolvedValueOnce({ok:true,data:record()}).mockResolvedValueOnce({ok:true,data:record({etag:'"revision-9"',revision_number:9,metadata:{visual_layout:{schema_version:1,rows:[]}}})});
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    await user.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByRole("button",{name:"Reload server draft"})).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Reload server draft"}));
    expect(await screen.findByText(/Server draft reloaded/)).toBeTruthy();
    expect(screen.getByText("Welcome to your Site")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save.mockResolvedValueOnce({ok:true,data:record({etag:'"revision-10"',revision_number:10,metadata:{visual_layout:starterLayout()}})});
    await user.click(screen.getByRole("button",{name:"Save draft"}));
    await waitFor(()=>expect(save).toHaveBeenLastCalledWith(11,id,'"revision-9"',expect.objectContaining({schema_version:1})));
  });
  it("warns before discarding unsaved edits when leaving the builder",async()=>{
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    await user.click(screen.getByRole("button",{name:"Back to Pages"}));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved visual draft changes?");
    expect(push).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button",{name:"Back to Pages"}));
    expect(push).toHaveBeenCalledWith(`/sites/11/admin/pages`);
    confirm.mockRestore();
  });
  it('saves current edits and opens a revision-bound preview in a new tab',async()=>{
    const replace=vi.fn();
    const target={opener:null,location:{replace},close:vi.fn()};
    const openWindow=vi.spyOn(window,'open').mockReturnValue(target as unknown as Window);
    try {
      const user=userEvent.setup();render(<VisualBuilder {...props}/>);
      await user.click(await screen.findByRole('button',{name:'Use sample starter'}));
      await user.click(screen.getByRole('button',{name:'Preview in new tab'}));
      await waitFor(()=>expect(replace).toHaveBeenCalledWith(`/admin/sites/11/admin/pages/${id}/preview?revision=2`));
      expect(save).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(target.close).not.toHaveBeenCalled();
    } finally {openWindow.mockRestore();}
  });
  it('keeps the editor and closes the preview tab when saving conflicts',async()=>{
    const target={opener:null,location:{replace:vi.fn()},close:vi.fn()};
    const openWindow=vi.spyOn(window,'open').mockReturnValue(target as unknown as Window);
    save.mockResolvedValueOnce(fail(409));
    try {
      const user=userEvent.setup();render(<VisualBuilder {...props}/>);
      await user.click(await screen.findByRole('button',{name:'Use sample starter'}));
      await user.click(screen.getByRole('button',{name:'Preview in new tab'}));
      await waitFor(()=>expect(target.close).toHaveBeenCalled());
      expect(target.location.replace).not.toHaveBeenCalled();
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
    } finally {openWindow.mockRestore();}
  });
  it("offers server-advertised workflow actions after a saved draft and reports authoritative status",async()=>{
    save.mockImplementation(async(_site:number,_id:string,_etag:string,tree:unknown)=>({ok:true,data:record({metadata:{visual_layout:tree},etag:'"revision-2"',revision_number:2,available_actions:["submit"]})}));
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    expect((screen.getByRole("button",{name:/Submit Admissions for review/}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText(/Visual draft saved/)).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/Submit Admissions for review/}));
    const dialog=await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button",{name:/Confirm|Submit/i}));
    expect(await screen.findByText(/Workflow submit completed. Status is now IN_REVIEW/)).toBeTruthy();
    expect(transition).toHaveBeenCalledWith(11,id,"submit","",'"revision-2"');
    expect(screen.getByText(/Revision 3 · IN_REVIEW/)).toBeTruthy();
    expect(screen.getByText("Review revision")).toBeTruthy();
  });
  it("uses the canonical saved tree/revision and keeps local undo distinct from CMS history",async()=>{
    save.mockImplementation(async(_site:number,_id:string,_etag:string,tree:unknown)=>({ok:true,data:record({metadata:{visual_layout:tree},etag:'"revision-2"',revision_number:2})}));
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    await user.click(screen.getByText("Row layout controls"));
    await user.click(screen.getByRole("button",{name:"Move row 2 up"}));
    await user.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Visual draft saved. The public revision is unchanged.")).toBeTruthy();
    expect(screen.getByText(/Revision 2/)).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Undo"}));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
  it("undo and redo restore layout order and selection, and a divergent edit clears redo",async()=>{
    const user=userEvent.setup();load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("tab",{name:"Structure"}));
    await user.click((await screen.findAllByRole("button",{name:/Select Headline/}))[0]!);
    expect((screen.getByRole("textbox",{name:"Text"}) as HTMLInputElement).value).toBe("Welcome to your Site");
    await user.click(screen.getByText("Row layout controls"));
    await user.click(screen.getByRole("button",{name:"Move row 2 up"}));
    await user.click(screen.getByRole("button",{name:"Undo"}));
    expect((screen.getByRole("button",{name:"Redo"}) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button",{name:"Redo"}));
    await user.click(screen.getByRole("button",{name:"Undo"}));
    await user.click(screen.getAllByRole("button",{name:"Add row"})[0]!);
    expect((screen.getByRole("button",{name:"Redo"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps Ctrl+Z for the builder outside inspector fields and clears history on Page switch",async()=>{
    const user=userEvent.setup();load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    const view=render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByText("Row layout controls"));
    await user.click(screen.getByRole("button",{name:"Move row 2 up"}));
    expect((screen.getByRole("button",{name:"Undo"}) as HTMLButtonElement).disabled).toBe(false);
    await user.click(await screen.findByRole("tab",{name:"Structure"}));
    await user.click((await screen.findAllByRole("button",{name:/Select Headline/}))[0]!);
    const field=screen.getByRole("textbox",{name:"Text"});
    await user.click(field);
    await user.keyboard("{Control>}z{/Control}");
    expect((screen.getByRole("button",{name:"Undo"}) as HTMLButtonElement).disabled).toBe(false);
    screen.getByRole("button",{name:"Undo"}).focus();
    await user.keyboard("{Control>}z{/Control}");
    expect((screen.getByRole("button",{name:"Undo"}) as HTMLButtonElement).disabled).toBe(true);
    load.mockResolvedValue({ok:true,data:record({site:22,id:other,title:"Medicine Page",metadata:{visual_layout:starterLayout()}})});
    view.rerender(<VisualBuilder {...props} siteId={22} siteName="Medicine" pageId={other}/>);
    expect(await screen.findByRole("heading",{level:2,name:"Medicine Page"})).toBeTruthy();
    expect((screen.getByRole("button",{name:"Undo"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button",{name:"Redo"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("ignores late Page results and clears selection, picker, focus mode and inspector on Site/Page changes",async()=>{
    const user=userEvent.setup();load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    const view=render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("tab",{name:"Structure"}));
    await user.click((await screen.findAllByRole("button",{name:/Select Headline/}))[0]!);
    expect(screen.getByRole("textbox",{name:"Text"})).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Focus mode"}));
    await user.click(screen.getByText("Row layout controls"));
    await user.click(screen.getByRole("button",{name:"Add widget to row 1 column 1"}));
    expect(await screen.findByRole("dialog",{name:/Choose a widget/})).toBeTruthy();
    let resolve!:(value:ActionResult<SitePageRecord>)=>void;
    load.mockImplementationOnce(()=>new Promise<ActionResult<SitePageRecord>>(done=>{resolve=done;}));
    view.rerender(<VisualBuilder {...props} pageId={other}/>);
    expect(screen.queryByRole("textbox",{name:"Text"})).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    load.mockResolvedValue({ok:true,data:record({site:22,id:other,title:"Medicine Page"})});
    view.rerender(<VisualBuilder {...props} siteId={22} siteName="Medicine" pageId={other}/>);
    expect(await screen.findByRole("heading",{name:"Medicine Page"})).toBeTruthy();
    await act(async()=>resolve({ok:true,data:record({id:other,title:"Late Informatics"})}));
    expect(screen.queryByText("Late Informatics")).toBeNull();
    expect(screen.queryByRole("textbox",{name:"Text"})).toBeNull();
    expect(screen.getByText(/Choose a widget on the canvas or in Structure/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"Focus mode"})).toBeTruthy();
  });
  it("shows backend denial and retryable transport errors without exposing a former canvas",async()=>{
    load.mockResolvedValue(fail(403));const view=render(<VisualBuilder {...props}/>);
    expect(await screen.findByText(/not available for visual editing/)).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Retry"})).toBeNull();
    load.mockResolvedValue(fail(503));view.rerender(<VisualBuilder {...props} pageId={other}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Retry"}));
    expect(load).toHaveBeenCalledWith(11,other);
  });
  it("opens the existing private working draft for a published Page before allowing canvas edits",async()=>{
    load.mockResolvedValue({ok:true,data:record({status:"PUBLISHED"})});open.mockResolvedValue({ok:true,data:record({id:other,draft_of:id})});
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    expect(await screen.findByText(/This is the published Page/)).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Save draft"})).toBeNull();
    await user.click(screen.getByRole("button",{name:"Open working draft"}));
    await waitFor(()=>expect(push).toHaveBeenCalledWith(`/sites/11/admin/pages/${other}/builder`));
    expect(open).toHaveBeenCalledWith(11,id,'"revision-1"');
  });
  it("keeps the canvas visible in focus mode and Escape returns to the full workspace",async()=>{
    const user=userEvent.setup();render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("button",{name:"Use sample starter"}));
    await user.click(screen.getByRole("button",{name:"Focus mode"}));
    expect(screen.queryByRole("navigation",{name:"Nested layout outline"})).toBeNull();
    expect(screen.queryByRole("tab",{name:"Widgets"})).toBeNull();
    expect(screen.getByRole("region",{name:"Live Page canvas"})).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("tab",{name:"Widgets"})).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"Focus mode"}));
    await user.click(screen.getByRole("tab",{name:"Structure"}));
    expect(screen.getByRole("navigation",{name:"Nested layout outline"})).toBeTruthy();
  });
  it("shows selection chrome actions for the active canvas widget",async()=>{
    const user=userEvent.setup();load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("tab",{name:"Structure"}));
    await user.click((await screen.findAllByRole("button",{name:/Select Headline/}))[0]!);
    expect(screen.getByRole("button",{name:/Canvas delete Headline/})).toBeTruthy();
    expect(screen.getByRole("button",{name:/Canvas duplicate Headline/})).toBeTruthy();
    expect(screen.getByRole("button",{name:/Canvas move Headline up/})).toBeTruthy();
    expect(screen.getByRole("button",{name:/Canvas drag Headline/})).toBeTruthy();
  });
  it("exposes drag handles for Structure and row editor widget reordering",async()=>{
    const user=userEvent.setup();
    load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    render(<VisualBuilder {...props}/>);
    await screen.findByRole("region",{name:"Live Page canvas"});
    expect(screen.getAllByRole("button",{name:/Drag Headline/}).length).toBeGreaterThan(0);
    expect(screen.getByRole("button",{name:"Drag row 1"})).toBeTruthy();
    await user.click(screen.getByRole("tab",{name:"Structure"}));
    expect(screen.getAllByRole("button",{name:/Drag Headline/}).length).toBeGreaterThan(1);
    expect(screen.getByText(/Drag the handle to reorder|Drop palette widgets/)).toBeTruthy();
  });
  it("makes palette widgets draggable onto the canvas drop targets and hides the automatic page title",async()=>{
    load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    render(<VisualBuilder {...props}/>);
    const canvas=await screen.findByRole("region",{name:"Live Page canvas"});
    expect(screen.getByTestId("live-canvas-drop-frame")).toBeTruthy();
    expect(getComputedStyle(screen.getByRole("heading",{level:1,name:"Admissions"})).position).toBe("absolute");
    const paletteCard=await screen.findByRole("button",{name:/Add Headline\. Drag onto the canvas/});
    expect(paletteCard.getAttribute("draggable")).toBe("true");
    expect(screen.getByText(/Drag onto the live canvas/)).toBeTruthy();
    const transfer={setData:vi.fn(),getData:(type:string)=>type==="text/plain"||type==="application/x-uog-visual-dnd"?"palette:button":"",effectAllowed:"none",dropEffect:"none",types:["text/plain"]};
    fireEvent.dragStart(paletteCard,{dataTransfer:transfer});
    fireEvent.dragOver(canvas,{dataTransfer:transfer});
    fireEvent.drop(canvas,{clientX:12,clientY:12,dataTransfer:transfer});
    await waitFor(()=>expect(screen.getByText(/Button added/i)).toBeTruthy());
  });
  it("accepts a palette drop on the empty canvas to create the first section",async()=>{
    render(<VisualBuilder {...props}/>);
    const empty=await screen.findByTestId("builder-empty-dropzone");
    const paletteCard=await screen.findByRole("button",{name:/Add Headline\. Drag onto the canvas/});
    const transfer={setData:vi.fn(),getData:()=>"palette:headline",effectAllowed:"none",dropEffect:"none",types:["text/plain"]};
    fireEvent.dragStart(paletteCard,{dataTransfer:transfer});
    fireEvent.drop(empty,{dataTransfer:transfer});
    await waitFor(()=>expect(screen.getByRole("region",{name:"Live Page canvas"})).toBeTruthy());
    expect(screen.getByText(/Headline added/i)).toBeTruthy();
  });
  it("sets a mobile spacing override, resets it to inherit, and keeps viewport chrome",async()=>{
    const user=userEvent.setup();
    load.mockResolvedValue({ok:true,data:record({metadata:{visual_layout:starterLayout()}})});
    render(<VisualBuilder {...props}/>);
    await user.click(await screen.findByRole("tab",{name:"Structure"}));
    await user.click(screen.getByRole("button",{name:/Select Row 1/}));
    expect(screen.getByText("Breakpoint overrides")).toBeTruthy();
    await user.click(screen.getByLabelText("Mobile spacing"));
    await user.click(await screen.findByRole("option",{name:"Lg"}));
    expect(screen.getByLabelText("Mobile spacing").textContent).toMatch(/Lg/i);
    await user.click(screen.getByLabelText("Mobile spacing"));
    await user.click(await screen.findByRole("option",{name:"Inherit"}));
    expect(screen.getByLabelText("Mobile spacing").textContent).toMatch(/Inherit/i);
    await user.click(screen.getByRole("button",{name:"Mobile"}));
    expect(screen.getByRole("group",{name:"Canvas viewport"})).toBeTruthy();
  });
});
