import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";
import { SitePostEditor } from "./site-post-editor";

const { get, transition, openDraft, push, replace } = vi.hoisted(() => ({get:vi.fn(),transition:vi.fn(),openDraft:vi.fn(),push:vi.fn(),replace:vi.fn()}));
vi.mock("next/navigation", () => ({useRouter:() => ({push,replace})}));
vi.mock("@/app/sites/post-actions", () => ({
  getSitePost:(...args:unknown[]) => get(...args),
  transitionSitePost:(...args:unknown[]) => transition(...args),
  openSitePostWorkingDraft:(...args:unknown[]) => openDraft(...args),
  loadSiteTaxonomy:async () => ({ok:true,data:[]}),
  createSiteTaxonomy:vi.fn(),createSitePost:vi.fn(),updateSitePost:vi.fn(),
}));

const record = {
  id:"post-1",site:11,title:"Campus report",slug:"campus-report",excerpt:"",content:"Saved body",blocks:[],
  editor_document:{schema_version:1,html:"<p>Saved body</p>"},seo:{},featured_media:"",featured_alt:"",
  categories:[],tags:[],status:"DRAFT",etag:'"r1"',revision_number:1,available_actions:["submit"],published_at:null,
};
const authorPermissions = ["content.posts.view","content.posts.create","content.posts.update"];
function editor(permissions=authorPermissions) {
  return render(<ToastProvider><SitePostEditor siteId={11} postsEnabled permissions={permissions} mode="edit" postId="post-1" /></ToastProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ok:true,data:record});
  transition.mockResolvedValue({ok:true,data:{...record,status:"IN_REVIEW",revision_number:2,etag:'"r2"',available_actions:[]}});
});

it("submits the saved revision and displays the backend-confirmed status", async () => {
  editor();
  fireEvent.click(await screen.findByRole("button",{name:"Submit Campus report for review"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm submit"}));
  await waitFor(() => expect(transition).toHaveBeenCalledWith(11,"post-1","submit","",'"r1"'));
  await screen.findByText(/Status:? in review/);
  expect(screen.queryByRole("button",{name:"Publish Campus report"})).toBeNull();
  expect(screen.queryByLabelText(/schedule/i)).toBeNull();
});

it("prevents transitions while unsaved text exists and retains text after a rejected transition", async () => {
  transition.mockResolvedValue({ok:false,error:{status:409,code:"workflow_conflict",message:"The revision changed. Reload and retry.",details:null,requestId:"review-conflict"}});
  editor();
  const body = await screen.findByRole("textbox",{name:"Article body"});
  body.innerHTML = "<p>Unsaved report</p>";
  fireEvent.input(body);
  expect(screen.getByRole("button",{name:"Submit Campus report for review"})).toHaveProperty("disabled",true);
  expect(body.textContent).toBe("Unsaved report");
  // Return to the saved text so a transition can be attempted without discarding work.
  body.innerHTML = "<p>Saved body</p>";
  fireEvent.input(body);
  fireEvent.click(screen.getByRole("button",{name:"Submit Campus report for review"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm submit"}));
  await screen.findByText(/The revision changed/);
  expect(body.textContent).toBe("Saved body");
  expect(screen.getByText(/Status:? draft/)).toBeTruthy();
});

it("lets a scoped reviewer read and reject with a required comment", async () => {
  get.mockResolvedValue({ok:true,data:{...record,status:"IN_REVIEW",available_actions:["approve","reject"],last_publication_at:"2026-11-12T12:00:00Z"}});
  transition.mockResolvedValue({ok:true,data:{...record,review_comment:"Please verify the figures.",revision_number:3}});
  editor(["content.posts.view","content.posts.review"]);
  const body = await screen.findByRole("textbox",{name:"Article body"});
  expect(body.getAttribute("aria-readonly")).toBe("true");
  fireEvent.click(screen.getByRole("button",{name:"Reject Campus report"}));
  expect(screen.getByRole("button",{name:"Confirm reject"})).toHaveProperty("disabled",true);
  fireEvent.change(screen.getByRole("textbox",{name:"Reviewer comment (required)"}),{target:{value:"Please verify the figures."}});
  fireEvent.click(screen.getByRole("button",{name:"Confirm reject"}));
  await screen.findByText(/Reviewer comment:? Please verify/);
  expect(transition).toHaveBeenCalledWith(11,"post-1","reject","Please verify the figures.",'"r1"');
});

it("opens a working draft from the published revision and previews in a new tab from the sticky bar", async () => {
  const open = vi.fn(() => ({ opener: null, close: vi.fn(), location: { replace: vi.fn() } }));
  vi.stubGlobal("open", open);
  get.mockResolvedValue({ok:true,data:{...record,status:"PUBLISHED",available_actions:[],published_at:"2026-11-12T12:00:00Z"}});
  openDraft.mockResolvedValue({ok:true,data:{...record,id:"working-1",draft_of:"post-1"}});
  editor();
  const preview = await screen.findByRole("button",{name:"Preview"});
  expect(preview).toHaveProperty("disabled", false);
  fireEvent.click(preview);
  await waitFor(() => expect(open).toHaveBeenCalled());
  const target = open.mock.results[0]?.value as { location: { replace: ReturnType<typeof vi.fn> } };
  expect(target.location.replace).toHaveBeenCalledWith(expect.stringContaining("/posts/post-1/preview"));
  fireEvent.click(screen.getByRole("button",{name:"Edit working draft"}));
  await waitFor(() => expect(openDraft).toHaveBeenCalledWith(11,"post-1",'"r1"'));
  expect(push).toHaveBeenCalledWith("/sites/11/admin/posts/working-1/edit");
  vi.unstubAllGlobals();
});
