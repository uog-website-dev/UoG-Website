import {render,screen,act} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import userEvent from "@testing-library/user-event";
import type {WidgetNode,VisualLayout} from "@uog/types";
import {VisualLayoutView} from "./visual-layout";
import {VisualPostProvider} from "./widget-runtime";

const page="00000000-0000-4000-8000-000000000001";
const asset="00000000-0000-4000-8000-000000000002";
const fetchMock=vi.fn();
function layout(widgets:WidgetNode[]):VisualLayout{return {schema_version:1,rows:[{id:"row",type:"section",ratios:[100],columns:[{id:"column",type:"column",children:widgets}]}]};}
function response(site:number,results:unknown[]){return {ok:true,status:200,json:async()=>({site,results})};}
const post={site:11,id:page,title:"Campus news",slug:"campus-news",excerpt:"Campus excerpt",featured_media:`sites/11/assets/${asset}`};
beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);});
afterEach(()=>vi.unstubAllGlobals());

describe("Configured widget runtime",()=>{
  it("loads Site title and logo once with same-Site identity data",async()=>{
    fetchMock.mockResolvedValue(response(11,[{name:"Informatics",logo_asset_id:asset,logo_url:"/api/v1/site-context/identity/logo/"}]));
    render(<VisualLayoutView siteId={11} pageTitle="Home" layout={layout([{id:"title",type:"site_title",props:{}},{id:"logo",type:"site_logo",props:{}}])}/>);
    expect(await screen.findByRole("heading",{name:"Informatics"})).toBeTruthy();
    expect(screen.getByRole("img",{name:"Informatics"}).getAttribute("src")).toBe("/api/v1/site-context/identity/logo/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("ignores stale identity responses when the active Site changes",async()=>{
    let resolve!:(value:unknown)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const tree=layout([{id:"title",type:"site_title",props:{}}]);
    const view=render(<VisualLayoutView siteId={11} pageTitle="A" layout={tree}/>);
    fetchMock.mockResolvedValue(response(22,[{name:"Medicine"}]));
    view.rerender(<VisualLayoutView siteId={22} pageTitle="B" layout={tree}/>);
    expect(await screen.findByRole("heading",{name:"Medicine"})).toBeTruthy();
    await act(async()=>resolve(response(11,[{name:"Late Informatics"}])));
    expect(screen.queryByText("Late Informatics")).toBeNull();
  });
  it("filters the published Loop Grid using the active taxonomy selection",async()=>{
    fetchMock.mockImplementation(async(url:string)=>{
      const query=new URL(url,"http://localhost").searchParams;
      if(query.get("source")==="taxonomy")return response(11,[{id:"news",name:"News",slug:"news"}]);
      return response(11,query.get("category")==="news"?[{...post,title:"Filtered news"}]:[post]);
    });
    const user=userEvent.setup();
    render(<VisualLayoutView siteId={11} pageTitle="Home" layout={layout([
      {id:"filter",type:"taxonomy_filter",props:{taxonomy_code:"categories",limit:10}},
      {id:"grid",type:"loop_grid",props:{source:"posts",limit:5}},
    ])}/>);
    expect(await screen.findByRole("heading",{name:"Campus news"})).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox",{name:"Filter by category"}),"news");
    expect(await screen.findByRole("heading",{name:"Filtered news"})).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"Campus news"})).toBeNull();
    expect(screen.getByRole("img",{name:"Filtered news"}).getAttribute("src")).toContain(`/api/v1/site-context/media/${asset}/`);
  });
  it("switches Post fields and hides a foreign Post",()=>{
    const tree=layout([{id:"title",type:"post_title",props:{}},{id:"excerpt",type:"post_excerpt",props:{}},{id:"image",type:"featured_image",props:{}}]);
    const view=render(<VisualPostProvider siteId={11} post={post}><VisualLayoutView siteId={11} pageTitle="Template" layout={tree}/></VisualPostProvider>);
    expect(screen.getByRole("heading",{name:"Campus news"})).toBeTruthy();
    view.rerender(<VisualPostProvider siteId={11} post={{...post,title:"Second Post",excerpt:"Second excerpt"}}><VisualLayoutView siteId={11} pageTitle="Template" layout={tree}/></VisualPostProvider>);
    expect(screen.getByRole("heading",{name:"Second Post"})).toBeTruthy();
    expect(screen.getByText("Second excerpt")).toBeTruthy();
    expect(screen.queryByText("Campus excerpt")).toBeNull();
    view.rerender(<VisualPostProvider siteId={11} post={{...post,site:22,title:"Foreign secret"}}><VisualLayoutView siteId={11} pageTitle="Template" layout={tree}/></VisualPostProvider>);
    expect(screen.queryByText("Foreign secret")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("loads private Post preview choices through the scoped proxy",async()=>{
    fetchMock.mockResolvedValue(response(11,[post]));
    const user=userEvent.setup();
    render(<VisualLayoutView siteId={11} pageId={page} preview mediaBase="/admin/sites/11/media" pageTitle="Template" layout={layout([{id:"title",type:"post_title",props:{}}])}/>);
    await user.selectOptions(await screen.findByRole("combobox",{name:"Preview Post context"}),post.id);
    expect(screen.getByRole("heading",{name:"Campus news"})).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toContain(`/admin/sites/11/pages/${page}/widget-data?`);
  });
  it("validates contact fields and correlates an unchanged retry",async()=>{
    fetchMock.mockRejectedValueOnce(new Error("Network interruption"));
    fetchMock.mockResolvedValue({status:202});
    const user=userEvent.setup();
    render(<VisualLayoutView siteId={11} pageId={page} pageTitle="Contact" layout={layout([{id:"contact",type:"contact_form",props:{form_code:"contact.v1",submit_label:"Send message"}}])}/>);
    await user.click(screen.getByRole("button",{name:"Send message"}));
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox",{name:/Name/}),"Visitor");
    await user.type(screen.getByRole("textbox",{name:/Email/}),"visitor@example.org");
    await user.type(screen.getByRole("textbox",{name:/Message/}),"A question");
    await user.click(screen.getByRole("button",{name:"Send message"}));
    expect(await screen.findByText("Network interruption")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Send message"}));
    expect(await screen.findByText("Your message has been received.")).toBeTruthy();
    const first=JSON.parse(fetchMock.mock.calls[0]![1].body);
    const retry=JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(first.request_id).toBe(retry.request_id);
    expect(first.email).toBe("visitor@example.org");
    expect(first.site).toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/v1/site-context/contact/${page}/contact.v1/`);
  });
  it("disables contact submission in private preview",()=>{
    render(<VisualLayoutView siteId={11} pageId={page} preview mediaBase="/admin/sites/11/media" pageTitle="Contact" layout={layout([{id:"contact",type:"contact_form",props:{form_code:"contact",submit_label:"Send"}}])}/>);
    expect((screen.getByRole("button",{name:"Send"}) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
