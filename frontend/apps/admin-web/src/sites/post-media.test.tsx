import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";
import { SitePostEditor } from "./site-post-editor";
import { PostRichEditor } from "./post-rich-editor";

const { update, get, push } = vi.hoisted(() => ({update:vi.fn(),get:vi.fn(),push:vi.fn()}));
const assetId = "11111111-1111-4111-8111-111111111111";
vi.mock("next/navigation", () => ({useRouter:() => ({push})}));
vi.mock("@/app/sites/post-actions", () => ({
  getSitePost:(...args:unknown[]) => get(...args),
  updateSitePost:(...args:unknown[]) => update(...args),
  loadSiteTaxonomy:async () => ({ok:true,data:[]}),
  createSiteTaxonomy:vi.fn(),
  createSitePost:vi.fn(),
}));
vi.mock("./media-picker", () => ({
  MediaPickerDialog:({open,onConfirm}:{open:boolean;onConfirm:(result:unknown)=>void}) => open ? <button onClick={() => onConfirm({assetId:"11111111-1111-4111-8111-111111111111",altText:"Campus gardens",originalFilename:"campus.png",contentType:"image/png",byteCount:100})}>Select campus image</button> : null,
}));

const permissions = ["content.posts.view","content.posts.create","content.posts.update","content.media.view","content.media.upload"];
beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ok:true,data:{
    id:"post-1",site:11,title:"Campus update",slug:"campus-update",excerpt:"",content:"Body",blocks:[],
    editor_document:{schema_version:1,html:"<p>Body</p>"},seo:{},featured_media:"",featured_alt:"",
    categories:[],tags:[],status:"DRAFT",etag:'"r1"',
  }});
  update.mockImplementation(async (_site:number,_post:string,_etag:string,fields:Record<string,unknown>) => ({ok:true,data:{...(await get()).data,...fields,etag:'"r2"'}}));
});

it("saves a featured asset identity and editable alternative text", async () => {
  render(<ToastProvider><SitePostEditor siteId={11} postsEnabled mediaEnabled permissions={permissions} mode="edit" postId="post-1" /></ToastProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Choose featured image"}));
  fireEvent.click(screen.getByRole("button",{name:"Select campus image"}));
  const alt = screen.getByRole("textbox",{name:"Featured image alternative text"});
  expect(alt).toHaveProperty("value","Campus gardens");
  fireEvent.change(alt,{target:{value:"Gardens around the university library"}});
  fireEvent.click(screen.getByRole("button",{name:"Save Draft"}));
  await waitFor(() => expect(update).toHaveBeenCalledWith(11,"post-1",'"r1"',expect.objectContaining({featured_media:`sites/11/assets/${assetId}`,featured_alt:"Gardens around the university library"})));
});

it("removes the featured reference and retains the article body", async () => {
  const response = await get();
  get.mockResolvedValue({ok:true,data:{...response.data,featured_media:`sites/11/assets/${assetId}`,featured_alt:"Campus gardens"}});
  render(<ToastProvider><SitePostEditor siteId={11} postsEnabled mediaEnabled permissions={permissions} mode="edit" postId="post-1" /></ToastProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Remove featured image"}));
  fireEvent.click(screen.getByRole("button",{name:"Save Draft"}));
  await waitFor(() => expect(update).toHaveBeenCalledWith(11,"post-1",'"r1"',expect.objectContaining({featured_media:"",featured_alt:"",editor_document:{schema_version:1,html:"<p>Body</p>"}})));
});

it("hides attachment controls when MEDIA is disabled", async () => {
  render(<ToastProvider><SitePostEditor siteId={11} postsEnabled mediaEnabled={false} permissions={permissions} mode="edit" postId="post-1" /></ToastProvider>);
  await screen.findByRole("textbox",{name:"Article body"});
  expect(screen.queryByRole("button",{name:"Choose featured image"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Insert image"})).toBeNull();
});

it("inserts inline images with a stable placement ID and requires alternative text", async () => {
  const changed = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(document,"execCommand");
  Object.defineProperty(document,"execCommand",{configurable:true,value:(command:string,_ui:boolean,html:string) => {
    if (command === "insertHTML") document.querySelector('[aria-label="Article body"]')!.insertAdjacentHTML("beforeend",html);
    return true;
  }});
  try {
    render(<PostRichEditor siteId={11} canUseMedia value="<p>Body</p>" onChange={changed} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button",{name:"Insert image"}));
    fireEvent.click(screen.getByRole("button",{name:"Select campus image"}));
    const alt = await screen.findByRole("textbox",{name:"Image alternative text"});
    fireEvent.change(alt,{target:{value:""}});
    expect(screen.getByRole("button",{name:"Insert image"})).toHaveProperty("disabled",true);
    fireEvent.change(alt,{target:{value:"Campus gardens"}});
    fireEvent.click(screen.getByRole("button",{name:"Insert image"}));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const html = changed.mock.calls.at(-1)![0] as string;
    expect(html).toContain(`data-asset-id="${assetId}"`);
    expect(html).toMatch(/data-node-id="[0-9a-f-]{36}"/);
    expect(html).toContain('alt="Campus gardens"');
    expect(html).not.toContain("src=");
  } finally {
    if (previous) Object.defineProperty(document,"execCommand",previous);
    else Reflect.deleteProperty(document,"execCommand");
  }
});
