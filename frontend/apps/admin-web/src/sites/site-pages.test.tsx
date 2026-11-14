import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";
import layoutFixtures from "../../../../packages/types/src/layout/fixtures.json";

import type { SitePageRecord, SitePageStatus } from "@/app/sites/page-actions";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const loadSitePages = vi.fn();
const loadSitePageStatusCounts = vi.fn();
const getSitePage = vi.fn();
const getSitePagePreview = vi.fn();
const createSitePage = vi.fn();
const updateSitePage = vi.fn();
const transitionSitePage = vi.fn();
const setSiteHomepage = vi.fn();
const loadSitePageWorkflowHistory = vi.fn();
const openWorkingDraft = vi.fn();

vi.mock("@/app/sites/page-actions", () => ({
  loadSitePages: (...args: unknown[]) => loadSitePages(...args),
  loadSitePageStatusCounts: (...args: unknown[]) => loadSitePageStatusCounts(...args),
  getSitePage: (...args: unknown[]) => getSitePage(...args),
  getSitePagePreview: (...args: unknown[]) => getSitePagePreview(...args),
  createSitePage: (...args: unknown[]) => createSitePage(...args),
  updateSitePage: (...args: unknown[]) => updateSitePage(...args),
  transitionSitePage: (...args: unknown[]) => transitionSitePage(...args),
  loadSitePageWorkflowHistory: (...args: unknown[]) => loadSitePageWorkflowHistory(...args),
  openWorkingDraft: (...args: unknown[]) => openWorkingDraft(...args),
  setSiteHomepage: (...args: unknown[]) => setSiteHomepage(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/sites/11/admin/pages",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { SitePagesPanel } from "./site-pages";
import { SitePageEditor } from "./site-page-editor";
import { SiteAdminFrame, SiteSection } from "./site-admin-frame";
import type { SiteAdminSite } from "./site-admin-frame";

const ALL_PERMISSIONS = [
  "content.pages.view",
  "content.pages.create",
  "content.pages.update",
  "content.pages.publish",
];

function draft(partial: Partial<SitePageRecord> = {}): SitePageRecord {
  return {
    id: "page-1",
    site: 11,
    parent: null,
    title: "Admissions",
    slug: "admissions",
    path: "/admissions",
    status: "DRAFT",
    visibility: "PUBLIC",
    locale: "en-us",
    is_homepage: false,
    created_by: 7,
    updated_at: "2026-03-20T10:00:00Z",
    etag: '"cms-content-page-1-r1"',
    blocks: [{
      type: "paragraph",
      html: "<p>Hello<script>alert(1)</script> <a href=\"javascript:alert(2)\">Bad</a> <a href=\"/about\">About</a></p>",
    }],
    available_actions: partial.available_actions ?? (partial.status === "IN_REVIEW"
      ? ["approve", "reject"]
      : partial.status === "APPROVED" ? ["publish", "archive"]
        : partial.status === "PUBLISHED" ? ["unpublish", "archive"]
          : partial.status === "UNPUBLISHED" ? ["restore", "archive"]
            : partial.status === "ARCHIVED" ? [] : ["submit"]),
    ...partial,
  };
}

function counts(): Record<SitePageStatus, number> {
  return {
    DRAFT: 1,
    IN_REVIEW: 0,
    APPROVED: 0,
    PUBLISHED: 0,
    UNPUBLISHED: 0,
    ARCHIVED: 0,
  };
}

function pageResult(results: SitePageRecord[], count = results.length) {
  return { ok: true, data: { count, next: null, previous: null, results } };
}

function renderPanel(
  siteId = 11,
  pagesEnabled: boolean | null = true,
  permissions: readonly string[] = ALL_PERMISSIONS,
) {
  return render(
    <ToastProvider>
      <SitePagesPanel siteId={siteId} pagesEnabled={pagesEnabled} builderEnabled permissions={permissions} />
    </ToastProvider>,
  );
}


function renderEditor(
  mode: "create" | "edit",
  options: {
    siteId?: number;
    pagesEnabled?: boolean | null;
    permissions?: readonly string[];
    languages?: { defaultLanguage: string; enabled: readonly string[] };
    pageId?: string;
  } = {},
) {
  return render(
    <ToastProvider>
      <SitePageEditor
        siteId={options.siteId ?? 11}
        pagesEnabled={options.pagesEnabled ?? true}
        permissions={options.permissions ?? ALL_PERMISSIONS}
        languages={options.languages}
        mode={mode}
        pageId={options.pageId}
      />
    </ToastProvider>,
  );
}

function siteWorkspace(site: SiteAdminSite, permissions: readonly string[]) {
  return (
    <ToastProvider>
      <SiteAdminFrame
        site={site}
        enabledModuleCodes={["PAGES"]}
        permissions={[...permissions]}
      >
        <SiteSection sectionKey="pages">
          <SitePagesPanel siteId={site.id} pagesEnabled permissions={permissions} />
        </SiteSection>
      </SiteAdminFrame>
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  push.mockReset();
  loadSitePages.mockResolvedValue(pageResult([draft()]));
  loadSitePageStatusCounts.mockResolvedValue({ ok: true, data: counts() });
  getSitePage.mockResolvedValue({ ok: true, data: draft() });
  createSitePage.mockResolvedValue({ ok: true, data: draft() });
  transitionSitePage.mockResolvedValue({ ok: true, data: draft({ status: "IN_REVIEW" }) });
  loadSitePageWorkflowHistory.mockResolvedValue({ ok: true, data: [] });
  openWorkingDraft.mockResolvedValue({ ok: true, data: draft() });
  setSiteHomepage.mockResolvedValue({ ok: true, data: draft({ is_homepage: true }) });
  updateSitePage.mockResolvedValue({ ok: true, data: draft({ title: "Admissions updated" }) });
});

describe("SitePagesPanel", () => {
  it("saves a shell-only change without resending builder blocks or metadata",async()=>{
    const metadata={visual_layout:layoutFixtures[0].layout};
    getSitePage.mockResolvedValue({ok:true,data:draft({layout:"FULL_WIDTH",metadata,blocks:[]})});
    renderEditor("edit",{pageId:"page-1"});
    const selector=await screen.findByRole("combobox",{name:"Page layout"});
    await waitFor(()=>expect(screen.getByRole("button",{name:"Save changes"}).hasAttribute("disabled")).toBe(false));
    fireEvent.mouseDown(selector);fireEvent.click(await screen.findByRole("option",{name:"Left Sidebar"}));
    fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
    await waitFor(()=>expect(updateSitePage).toHaveBeenCalledWith(11,"page-1",'"cms-content-page-1-r1"',{layout:"LEFT_SIDEBAR"}));
    expect(metadata.visual_layout).toEqual(layoutFixtures[0].layout);
  });

  it("assigns only published Pages allowed by the backend as the homepage", async () => {
    loadSitePages.mockResolvedValue(pageResult([
      draft({status:"PUBLISHED",can_set_homepage:true}),
      draft({id:"page-2",title:"Private draft",can_set_homepage:false}),
    ]));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", {name:"Set Admissions as homepage"}));
    await waitFor(() => expect(setSiteHomepage).toHaveBeenCalledWith(11,"page-1"));
    expect(screen.queryByRole("button", {name:"Set Private draft as homepage"})).toBeNull();
  });

  it("renders a site-scoped accessible table and status dashboard", async () => {
    loadSitePages.mockResolvedValue(pageResult([
      draft(),
      draft({ id: "page-9", site: 22, title: "Hospital" }),
    ], 2));
    renderPanel();

    const table = await screen.findByRole("table", { name: "Pages for this Site" });
    expect(within(table).getByText("Admissions")).toBeTruthy();
    expect(within(table).getByText("/admissions")).toBeTruthy();
    expect(within(table).getByText("User 7")).toBeTruthy();
    expect(within(table).queryByText("Hospital")).toBeNull();
    expect(screen.getByRole("region", { name: "Page status dashboard" })).toBeTruthy();
    expect(screen.getByText("Total").parentElement?.textContent).toContain("1");
    expect(screen.getByRole("link", { name: "Preview Admissions" }).getAttribute("href")).toBe("/sites/11/admin/pages/page-1/preview");
    expect(screen.getByRole("link", { name: "Open Visual Builder for Admissions" }).getAttribute("href")).toBe("/sites/11/admin/pages/page-1/builder");
  });

  it("announces empty and failed API list states", async () => {
    loadSitePages.mockResolvedValueOnce(pageResult([]));
    const emptyView = renderPanel();
    expect(await screen.findByText("This Site does not have any Pages yet.")).toBeTruthy();
    emptyView.unmount();

    loadSitePages.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "Pages are unavailable to this account.",
        details: null,
        requestId: "request-1",
      },
    });
    renderPanel();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Pages are unavailable to this account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("applies server search and status filters and resets pagination", async () => {
    renderPanel();
    await screen.findByRole("table", { name: "Pages for this Site" });

    fireEvent.change(screen.getByRole("textbox", { name: "Search Pages" }), {
      target: { value: "  admissions  " },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "Draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(loadSitePages).toHaveBeenLastCalledWith(11, {
        search: "admissions",
        status: "DRAFT",
        page: 1,
        page_size: 20,
        ordering: "-updated_at",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(loadSitePages).toHaveBeenLastCalledWith(11, {
        search: undefined,
        status: undefined,
        page: 1,
        page_size: 20,
        ordering: "-updated_at",
      });
    });
  });

  it("uses API pagination and resets to the first page when sorting changes", async () => {
    loadSitePages.mockResolvedValue(pageResult([draft()], 41));
    renderPanel();
    await screen.findByRole("table", { name: "Pages for this Site" });
    expect(screen.getByText("1–20 of 41")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(11, expect.objectContaining({ page: 2 })));

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(11, expect.objectContaining({
      page: 1,
      ordering: "title",
    })));
  });

  it("opens full-page preview in a new tab and submits this Site's draft for review", async () => {
    renderPanel();
    const preview = await screen.findByRole("link", { name: "Preview Admissions" });
    expect(preview.getAttribute("href")).toBe("/sites/11/admin/pages/page-1/preview");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toContain("noopener");

    fireEvent.click(await screen.findByRole("button", { name: "Submit Admissions for review" }));
    expect(screen.getByRole("dialog", { name: "Submit Page?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm submit" }));
    await waitFor(() => expect(transitionSitePage).toHaveBeenCalledWith(11, "page-1", "submit", ""));
    expect(JSON.stringify(transitionSitePage.mock.calls)).not.toContain("22");
  });

  it("shows review controls only from backend-authorized actions and requires a rejection comment", async () => {
    loadSitePages.mockResolvedValue(pageResult([draft({
      status: "IN_REVIEW",
      available_actions: ["approve", "reject"],
      created_by: 100,
      submitted_by: 100,
    })]));
    renderPanel(11, true, ["content.pages.view"]);
    expect(await screen.findByRole("button", { name: "Review queue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve Admissions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject Admissions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit Admissions for review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish Admissions" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review queue" }));
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(
      11, expect.objectContaining({ status: "IN_REVIEW", page: 1 }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Reject Admissions" }));
    expect(screen.getByRole("button", { name: "Confirm reject" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer comment (required)" }), {
      target: { value: "Please add sources." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() => expect(transitionSitePage).toHaveBeenCalledWith(
      11, "page-1", "reject", "Please add sources.",
    ));
  });

  it("shows append-only workflow history and reviewer feedback in a timeline", async () => {
    loadSitePageWorkflowHistory.mockResolvedValue({ ok: true, data: [{
      id: 1, from_status: "IN_REVIEW", to_status: "DRAFT", actor: 9,
      comment: "Please add sources.", created_at: "2026-03-20T10:00:00Z",
    }] });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Workflow history for Admissions" }));
    expect(await screen.findByRole("dialog", { name: "Workflow history: Admissions" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Page status timeline" }).textContent).toContain("Please add sources.");
    expect(loadSitePageWorkflowHistory).toHaveBeenCalledWith(11, "page-1");
  });

  it("defaults a new Page to the Site language", async () => {
    renderEditor("create", { languages: { defaultLanguage: "en-us", enabled: ["en-us", "am"] } });
    await screen.findByRole("heading", { name: "Create Page" });
    expect(screen.getByRole("combobox", { name: "Locale" }).textContent).toContain("en-us");
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Library hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Page" }));
    await waitFor(() => expect(createSitePage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ locale: "en-us", seo: {}, metadata: {} }),
    ));
    expect(push).toHaveBeenCalledWith("/sites/11/admin/pages");
  });

  it("links Create page to the dedicated create screen", async () => {
    renderPanel();
    await screen.findByRole("table", { name: "Pages for this Site" });
    expect(screen.getByRole("link", { name: "Create page" }).getAttribute("href")).toBe("/sites/11/admin/pages/new");
    expect(screen.getByRole("link", { name: "Edit Admissions" }).getAttribute("href")).toBe("/sites/11/admin/pages/page-1/edit");
  });

  it("starts a new Page blank and fills the slug from the title until it is edited", async () => {
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Page" });
    const title = screen.getByRole("textbox", { name: "Title" });
    const slug = screen.getByRole("textbox", { name: "Slug" });
    expect(title).toHaveProperty("value", "");
    expect(slug).toHaveProperty("value", "");
    expect(screen.queryByRole("textbox", { name: "Block 1 JSON" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create Page" })).toHaveProperty("disabled", true);

    fireEvent.change(title, { target: { value: "Graduate Admissions 2027" } });
    expect(slug).toHaveProperty("value", "graduate-admissions-2027");
    fireEvent.change(slug, { target: { value: "grad-admissions" } });
    fireEvent.change(title, { target: { value: "Graduate Admissions" } });
    expect(slug).toHaveProperty("value", "grad-admissions");
  });

  it("blocks create without create permission on the editor screen", async () => {
    renderEditor("create", { permissions: ["content.pages.view"] });
    expect(await screen.findByText(/do not have permission to create Pages/i)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("creates and edits only with the matching permission and current ETag", async () => {
    const createView = renderEditor("create");
    await screen.findByRole("heading", { name: "Create Page" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Admissions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Page" }));
    await waitFor(() => expect(createSitePage).toHaveBeenCalledWith(11, {
      layout:"FULL_WIDTH",
      title: "Admissions",
      slug: "admissions",
      parent: null,
      locale: "en",
      visibility: "PUBLIC",
      metadata: {},
      seo: {},
      blocks: [],
    }));
    expect(push).toHaveBeenCalledWith("/sites/11/admin/pages");
    createView.unmount();

    renderEditor("edit", { pageId: "page-1" });
    await waitFor(() => expect(getSitePage).toHaveBeenCalledWith(11, "page-1"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), {
      target: { value: "Admissions updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateSitePage).toHaveBeenCalledWith(
      11,
      "page-1",
      '"cms-content-page-1-r1"',
      {
        layout: "FULL_WIDTH", title: "Admissions updated", slug: "admissions", visibility: "PUBLIC",
        parent: null, metadata: {}, seo: {}, blocks: draft().blocks,
      },
    ));
  });

  it("surfaces stale edit conflicts without losing the form", async () => {
    updateSitePage.mockResolvedValue({
      ok: false,
      error: { status: 409, code: "conflict", message: "Content changed. Retrieve the current Page.", details: null, requestId: null },
    });
    renderEditor("edit", { pageId: "page-1" });
    await screen.findByRole("heading", { name: "Edit Page" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Content changed/i);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Admissions");
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(getSitePage).toHaveBeenCalledTimes(2));
  });

  it("previews private draft content and blocks malformed block JSON", async () => {
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Page" });
    fireEvent.click(screen.getByRole("button", { name: "Add paragraph block" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
    expect(screen.getByText("Private draft preview")).toBeTruthy();
    expect(screen.queryByRole("script")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Block 1 JSON" }), {
      target: { value: "{invalid" },
    });
    expect(screen.getByRole("button", { name: "Create Page" })).toHaveProperty("disabled", true);
    expect(screen.getAllByRole("alert").some((alert) => /JSON at position|Expected property/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("shows the frozen private revision and sends its exact ETag when publishing",async()=>{
    const visual=structuredClone(layoutFixtures[0]!.layout);
    const row=draft({status:"APPROVED",revision_number:8,metadata:{visual_layout:visual},available_actions:["publish"]});
    loadSitePages.mockResolvedValue(pageResult([row]));
    getSitePagePreview.mockResolvedValue({ok:true,data:{revision_id:80,revision_number:8,status:"APPROVED",content_hash:"hash",approval_id:4,reviewed_revision_id:79,approved_revision_id:80,etag:'"cms-content-page-1-r8"',page:{title:"Reviewed Page",path:"/admissions",site:11,blocks:[],metadata:{visual_layout:visual},seo:{}}}});
    renderPanel();
    fireEvent.click(await screen.findByRole("button",{name:"Publish Admissions"}));
    await screen.findByText("Private revision 8");
    expect(screen.getByRole("heading",{name:"Reviewed Page"})).toBeTruthy();
    expect(screen.getByRole("img",{name:"Campus"}).getAttribute("src")).toContain("/admin/sites/11/pages/page-1/preview-media/8/");
    fireEvent.click(screen.getByRole("button",{name:"Confirm publish"}));
    await waitFor(()=>expect(transitionSitePage).toHaveBeenCalledWith(11,"page-1","publish","",'"cms-content-page-1-r8"'));
    expect(getSitePagePreview).toHaveBeenCalledWith(11,"page-1",8);
  });

  it("previews the shared visual fixture and rejects unsupported layout versions before saving", async () => {
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Page" });
    fireEvent.click(screen.getByRole("button", {name:"Advanced"}));
    const field=screen.getByRole("textbox", {name:"Metadata (JSON object)"});
    fireEvent.change(field,{target:{value:JSON.stringify({visual_layout:layoutFixtures[0]!.layout})}});
    fireEvent.click(screen.getByRole("button",{name:"Preview draft"}));
    expect(screen.getByRole("region",{name:"Image slider"})).toBeTruthy();
    expect(screen.getByRole("heading",{name:"Our university"})).toBeTruthy();
    fireEvent.change(field,{target:{value:JSON.stringify({visual_layout:{schema_version:99,rows:[]}})}});
    expect(screen.getByRole("button",{name:"Create Page"})).toHaveProperty("disabled",true);
    expect(createSitePage).not.toHaveBeenCalled();
  });

  it("asks before discarding unsaved editor changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Page" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Changed title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Discard your unsaved Page changes?");
    expect(screen.getByRole("heading", { name: "Create Page" })).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sites/11/admin/pages"));
    confirm.mockRestore();
  });

  it("blocks management when the PAGES module is off", async () => {
    renderPanel(11, false);
    const submit = await screen.findByRole("button", { name: "Submit Admissions for review" });
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("link", { name: "Create page" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/Create, edit and workflow changes are blocked/)).toBeTruthy();
    fireEvent.click(submit);
    expect(transitionSitePage).not.toHaveBeenCalled();
  });

  it("clears filter and page state when the selected Site changes", async () => {
    const view = renderPanel(11);
    await screen.findByRole("table", { name: "Pages for this Site" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pages" }), {
      target: { value: "admissions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(
      11,
      expect.objectContaining({ search: "admissions", page: 1 }),
    ));

    view.rerender(
      <ToastProvider>
        <SitePagesPanel siteId={22} pagesEnabled permissions={ALL_PERMISSIONS} />
      </ToastProvider>,
    );
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(
      22,
      expect.objectContaining({ search: undefined, status: undefined, page: 1 }),
    ));
    expect(screen.getByRole("textbox", { name: "Search Pages" })).toHaveProperty("value", "");
    expect(screen.queryByText("Admissions")).toBeNull();
  });

  it("does not fetch or expose Pages without view permission", () => {
    renderPanel(11, true, ["content.pages.create"]);
    expect(screen.getByText(/do not have permission to view Pages/)).toBeTruthy();
    expect(loadSitePages).not.toHaveBeenCalled();
    expect(loadSitePageStatusCounts).not.toHaveBeenCalled();
  });

  it("switches Site scope and enforces view-only access across the admin workspace", async () => {
    loadSitePages.mockImplementation(async (siteId: number) => pageResult([
      draft({
        site: siteId,
        title: siteId === 11 ? "Informatics Admissions" : "Medicine Admissions",
      }),
    ]));
    const informatics: SiteAdminSite = {
      id: 11,
      name: "Informatics",
      code: "INFORMATICS",
      status: "ACTIVE",
    };
    const medicine: SiteAdminSite = {
      id: 22,
      name: "Medicine",
      code: "MEDICINE",
      status: "ACTIVE",
    };
    const view = render(siteWorkspace(informatics, ALL_PERMISSIONS));
    await screen.findByText("Informatics Admissions");

    view.rerender(siteWorkspace(medicine, ["content.pages.view"]));
    await screen.findByText("Medicine Admissions");
    await waitFor(() => expect(loadSitePages).toHaveBeenLastCalledWith(
      22,
      expect.objectContaining({ search: undefined, status: undefined, page: 1 }),
    ));
    expect(screen.queryByText("Informatics Admissions")).toBeNull();
    expect(screen.queryByRole("link", { name: "Create page" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
  });

  it("opens a working draft of a published Page and keeps the live route fixed", async () => {
    const published = draft({
      id: "live-1",
      status: "PUBLISHED",
      title: "Admissions",
      etag: '"cms-content-live-1-r1"',
    });
    const working = draft({
      id: "draft-1",
      title: "Admissions",
      slug: "wip-abc123",
      path: "/wip-abc123",
      status: "DRAFT",
      draft_of: "live-1",
      etag: '"cms-content-draft-1-r1"',
    });
    loadSitePages.mockResolvedValue(pageResult([published]));
    getSitePage.mockImplementation(async (_site: number, id: string) => ({
      ok: true,
      data: id === "draft-1" ? working : published,
    }));
    openWorkingDraft.mockResolvedValue({ ok: true, data: working });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Edit a draft of Admissions" }));
    await waitFor(() => expect(openWorkingDraft).toHaveBeenCalledWith(
      11, "live-1", '"cms-content-live-1-r1"',
    ));
    expect(push).toHaveBeenCalledWith("/sites/11/admin/pages/draft-1/edit");

    renderEditor("edit", { pageId: "draft-1" });
    await screen.findByRole("heading", { name: "Edit draft of published Page" });
    expect(screen.getByRole("textbox", { name: "Slug" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "Parent Page" }).getAttribute("aria-disabled")).toBe("true");
  });
});
