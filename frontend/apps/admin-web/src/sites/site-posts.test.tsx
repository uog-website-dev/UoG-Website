import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { SitePostRecord } from "@/app/sites/post-actions";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const loadSitePosts = vi.fn();
const loadSiteTaxonomy = vi.fn();
const createSiteTaxonomy = vi.fn();
const getSitePost = vi.fn();
const createSitePost = vi.fn();
const updateSitePost = vi.fn();
const transitionSitePost = vi.fn();
const openSitePostWorkingDraft = vi.fn();

vi.mock("@/app/sites/post-actions", () => ({
  loadSitePosts: (...args: unknown[]) => loadSitePosts(...args),
  loadSiteTaxonomy: (...args: unknown[]) => loadSiteTaxonomy(...args),
  createSiteTaxonomy: (...args: unknown[]) => createSiteTaxonomy(...args),
  getSitePost: (...args: unknown[]) => getSitePost(...args),
  createSitePost: (...args: unknown[]) => createSitePost(...args),
  updateSitePost: (...args: unknown[]) => updateSitePost(...args),
  transitionSitePost: (...args: unknown[]) => transitionSitePost(...args),
  openSitePostWorkingDraft: (...args: unknown[]) => openSitePostWorkingDraft(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/sites/11/admin/posts",
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

import { SitePostsPanel } from "./site-posts";
import { SitePostEditor } from "./site-post-editor";

const PERMISSIONS = ["content.posts.view", "content.posts.create", "content.posts.update"];
const category = { id: "category-1", site: 11, code: "NEWS", name: "News", slug: "news", is_active: true };
const tag = { id: "tag-1", site: 11, code: "CAMPUS", name: "Campus", slug: "campus", is_active: true };

function post(partial: Partial<SitePostRecord> = {}): SitePostRecord {
  return {
    id: "post-1", site: 11, title: "Campus update", slug: "campus-update",
    excerpt: "An update", content: "Post body", blocks: [{ type: "paragraph", html: "<p>Post body</p>" }],
    seo: {}, featured_media: "sites/11/campus.jpg",
    author: 42, categories: [category.id], tags: [tag.id], status: "DRAFT",
    published_at: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T10:00:00Z",
    ...partial,
  };
}

function result<T>(data: T) {
  return { ok: true, data };
}

function list(rows: SitePostRecord[], count = rows.length) {
  return result({ count, next: null, previous: null, results: rows });
}

function renderPanel(
  siteId = 11,
  postsEnabled: boolean | null = true,
  permissions: readonly string[] = PERMISSIONS,
) {
  return render(
    <ToastProvider>
      <SitePostsPanel siteId={siteId} postsEnabled={postsEnabled} permissions={permissions} />
    </ToastProvider>,
  );
}

function renderEditor(
  mode: "create" | "edit",
  options: {
    siteId?: number;
    postsEnabled?: boolean | null;
    permissions?: readonly string[];
    postId?: string;
  } = {},
) {
  return render(
    <ToastProvider>
      <SitePostEditor
        siteId={options.siteId ?? 11}
        postsEnabled={options.postsEnabled ?? true}
        permissions={options.permissions ?? PERMISSIONS}
        mode={mode}
        postId={options.postId}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  loadSitePosts.mockReset();
  loadSiteTaxonomy.mockReset();
  createSiteTaxonomy.mockReset();
  getSitePost.mockReset();
  createSitePost.mockReset();
  updateSitePost.mockReset();
  transitionSitePost.mockReset();
  openSitePostWorkingDraft.mockReset();
  loadSitePosts.mockResolvedValue(list([post()]));
  loadSiteTaxonomy.mockImplementation(async (siteId: number, kind: "categories" | "tags") => result(
    (siteId === 11 ? (kind === "categories" ? [category] : [tag]) : []).map((row) => ({ ...row, site: siteId })),
  ));
  getSitePost.mockResolvedValue(result({ ...post(), etag: '"post-v1"', editor_document: { schema_version: 1, html: "<p>Post body</p>" } }));
  createSitePost.mockResolvedValue(result({ ...post({ id: "post-2" }), etag: '"post-v1"', editor_document: { schema_version: 1, html: "<p>Story body</p>" } }));
  updateSitePost.mockResolvedValue(result({ ...post(), etag: '"post-v2"', editor_document: { schema_version: 1, html: "<p>Post body</p>" } }));
  createSiteTaxonomy.mockResolvedValue(result({ ...category, id: "category-new" }));
  transitionSitePost.mockResolvedValue(result(post({ status: "IN_REVIEW", available_actions: [] })));
});

describe("SitePostsPanel", () => {
  it("loads only the selected Site and renders status, author, taxonomy and featured media", async () => {
    loadSitePosts.mockResolvedValue(list([post(), post({ id: "foreign", site: 22, slug: "foreign" })]));
    renderPanel();
    const table = await screen.findByRole("table", { name: "Posts for this Site" });
    expect(within(table).getByText("Campus update")).toBeTruthy();
    expect(within(table).getByText("Draft")).toBeTruthy();
    expect(within(table).getByText("User 42")).toBeTruthy();
    expect(within(table).getByText("News")).toBeTruthy();
    expect(within(table).getByText("Campus")).toBeTruthy();
    expect(within(table).getByText("Set")).toBeTruthy();
    expect(within(table).queryByText("foreign")).toBeNull();
    expect(loadSitePosts).toHaveBeenCalledWith(11, expect.objectContaining({ page: 1, page_size: 20 }));
    expect(screen.getByTestId("posts-table-scroll")).toBeTruthy();
  });

  it("applies search, status, category and tag filters and resets them", async () => {
    renderPanel();
    await screen.findByRole("table", { name: "Posts for this Site" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search Posts" }), { target: { value: "  campus  " } });
    for (const [label, option] of [["Status", "Draft"], ["Category", "News"], ["Tag", "Campus"]] as const) {
      fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
      fireEvent.click(await screen.findByRole("option", { name: option }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(11, expect.objectContaining({
      search: "campus", status: "DRAFT", category: category.id, tag: tag.id,
    })));

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(11, expect.objectContaining({
      search: undefined, status: undefined, category: undefined, tag: undefined,
    })));
    expect((screen.getByRole("textbox", { name: "Search Posts" }) as HTMLInputElement).value).toBe("");
  });

  it("links Create and Edit to dedicated editor routes", async () => {
    renderPanel();
    await screen.findByRole("table", { name: "Posts for this Site" });
    expect(screen.getByRole("link", { name: "Create Post" }).getAttribute("href")).toBe("/sites/11/admin/posts/new");
    expect(screen.getByRole("link", { name: "Edit Campus update" }).getAttribute("href")).toBe("/sites/11/admin/posts/post-1/edit");
  });

  it("hides create/edit actions without permissions and blocks the disabled module", async () => {
    renderPanel(11, true, ["content.posts.view"]);
    await screen.findByRole("table", { name: "Posts for this Site" });
    expect(screen.queryByRole("link", { name: "Create Post" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit Campus update" })).toBeNull();

    loadSitePosts.mockClear();
    renderPanel(22, false, PERMISSIONS);
    expect(await screen.findByText(/Posts are disabled for this Site/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Create Post" })).toBeNull();
    expect(loadSitePosts).not.toHaveBeenCalled();
  });

  it("does not request or reveal Site Posts without view permission", async () => {
    renderPanel(11, true, []);
    expect(await screen.findByText("You do not have permission to view Posts for this Site.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Posts for this Site" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create Post" })).toBeNull();
    expect(loadSitePosts).not.toHaveBeenCalled();
    expect(loadSiteTaxonomy).not.toHaveBeenCalled();
  });

  it("shows empty and API error states", async () => {
    loadSitePosts.mockResolvedValue(list([], 0));
    renderPanel();
    expect(await screen.findByText("This Site does not have any Posts yet.")).toBeTruthy();

    loadSitePosts.mockResolvedValue({
      ok: false,
      error: { status: 403, code: "permission_denied", message: "Posts are unavailable.", details: null, requestId: "req-1" },
    });
    renderPanel(22);
    expect(await screen.findByText("Posts are unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("runs submit, approve and publish only when the API offers that action for this Site", async () => {
    const postId = "11111111-1111-1111-1111-111111111111";
    loadSitePosts.mockResolvedValue(list([
      post({ id: postId, available_actions: ["submit"] }),
      post({ id: "22222222-2222-2222-2222-222222222222", site: 22, title: "Other Site", available_actions: ["publish"] }),
    ]));
    const view = renderPanel();
    const table = await screen.findByRole("table", { name: "Posts for this Site" });
    expect(within(table).queryByText("Other Site")).toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "Submit Campus update for review" }));
    expect(screen.getByRole("dialog", { name: "Submit Post?" })).toBeTruthy();
    expect(screen.queryByLabelText(/schedule/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm submit" }));
    await waitFor(() => expect(transitionSitePost).toHaveBeenCalledWith(11, postId, "submit", ""));

    view.unmount();
    loadSitePosts.mockResolvedValue(list([post({ id: postId, status: "APPROVED", available_actions: ["publish"] })]));
    renderPanel(11, true, [...PERMISSIONS, "content.posts.publish"]);
    fireEvent.click(await screen.findByRole("button", { name: "Publish Campus update" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    await waitFor(() => expect(transitionSitePost).toHaveBeenCalledWith(11, postId, "publish", ""));
    expect(screen.queryByRole("button", { name: "Submit Campus update for review" })).toBeNull();
  });
});

describe("SitePostEditor", () => {
  it("creates drafts and edits with the detail ETag on the full-page editor", async () => {
    const createView = renderEditor("create");
    await screen.findByRole("heading", { name: "Create Post" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "New campus story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "new-campus-story" } });
    const body = screen.getByRole("textbox", { name: "Article body" });
    body.innerHTML = "<p>Story body</p>"; fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(createSitePost).toHaveBeenCalledWith(11, expect.objectContaining({
      title: "New campus story", slug: "new-campus-story", editor_document: { schema_version: 1, html: "<p>Story body</p>" }, seo: {},
    })));
    expect(replace).toHaveBeenCalledWith("/sites/11/admin/posts/post-2/edit");
    expect(await screen.findByText("Draft saved just now")).toBeTruthy();
    createView.unmount();

    renderEditor("edit", { postId: "post-1" });
    expect(await screen.findByRole("heading", { name: "Edit Post" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenCalledWith(11, "post-1", '"post-v1"', expect.any(Object)));
  });

  it("validates media scope and offers taxonomy creation only to authorized creators", async () => {
    renderEditor("create", { permissions: ["content.posts.view"] });
    expect(await screen.findByText(/do not have permission to create Posts/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create category" })).toBeNull();

    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Post" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Scoped story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "Bad Slug" } });
    expect(screen.getByText("Use lowercase letters and numbers separated by single hyphens.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "scoped-story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Featured image reference" }), { target: { value: "sites/22/foreign.jpg" } });
    expect(screen.getByText(/External and other-Site media are not allowed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(createSitePost).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Featured image reference" }), { target: { value: "sites/11/own.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Campus Life" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "BAD CODE" } });
    expect(screen.getByRole("button", { name: "Create and assign" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "CAMPUS_LIFE" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and assign" }));
    await waitFor(() => expect(createSiteTaxonomy).toHaveBeenCalledWith(11, "categories", expect.objectContaining({
      name: "Campus Life", code: "CAMPUS_LIFE", locale: "en",
    })));
  });

  it("previews the Site draft through the shared safe block renderer", async () => {
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    const body = screen.getByRole("textbox", { name: "Article body" });
    body.innerHTML = '<h2>Safe</h2><script>alert(1)</script><a href="javascript:alert(2)">bad</a>';
    fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
    const preview = await screen.findByRole("region", { name: "Private Post preview" });
    expect(preview.textContent).toContain("Safe");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("a")).toBeNull();
    expect(preview.textContent).not.toContain("javascript:");
  });

  it("keeps unsaved formatting after failed saves and warns before discard", async () => {
    updateSitePost.mockResolvedValue({ ok: false, error: { status: 503, code: "service_unavailable", message: "Please retry this save.", details: null, requestId: "draft-failed" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    const body = screen.getByRole("textbox", { name: "Article body" });
    body.innerHTML = "<h2>Unsaved report</h2><p><strong>Keep this text</strong></p>"; fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByText("Please retry this save.");
    expect(body.innerHTML).toContain("<strong>Keep this text</strong>");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved article changes?");
    expect(screen.getByRole("heading", { name: "Edit Post" })).toBeTruthy();
    updateSitePost.mockResolvedValue(result({ ...post(), etag: '"post-v2"', editor_document: { schema_version: 1, html: "<h2>Unsaved report</h2><p><strong>Keep this text</strong></p>" } }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenLastCalledWith(11, "post-1", '"post-v1"', expect.objectContaining({ editor_document: { schema_version: 1, html: "<h2>Unsaved report</h2><p><strong>Keep this text</strong></p>" } })));
    expect(await screen.findByText("Draft saved just now")).toBeTruthy();
    confirm.mockRestore();
  });

  it("preserves a stale draft and displays explicit conflict guidance", async () => {
    updateSitePost.mockResolvedValue({ ok: false, error: { status: 409, code: "conflict", message: "A newer revision exists.", details: null, requestId: "stale" } });
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    const body = screen.getByRole("textbox", { name: "Article body" });
    body.innerHTML = "<p>My private work</p>"; fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByText(/A newer revision exists.*Keep your text/);
    expect(body.textContent).toBe("My private work");
    expect(screen.getByRole("button", { name: "Keep my text & refresh" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load server version" })).toBeTruthy();
  });

  it("refreshes the revision marker after a conflict while keeping unsaved text", async () => {
    updateSitePost
      .mockResolvedValueOnce({ ok: false, error: { status: 409, code: "conflict", message: "A newer revision exists.", details: null, requestId: "stale" } })
      .mockResolvedValueOnce(result(post({ title: "Campus update" })));
    getSitePost
      .mockResolvedValueOnce(result({ ...post(), etag: '"post-v1"', editor_document: { schema_version: 1, html: "<p>Post body</p>" } }))
      .mockResolvedValueOnce(result({ ...post(), etag: '"post-v2"', editor_document: { schema_version: 1, html: "<p>Server body</p>" } }));
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    const body = screen.getByRole("textbox", { name: "Article body" });
    body.innerHTML = "<p>My private work</p>"; fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByRole("button", { name: "Keep my text & refresh" });
    fireEvent.click(screen.getByRole("button", { name: "Keep my text & refresh" }));
    await waitFor(() => expect(getSitePost).toHaveBeenCalledTimes(2));
    expect(body.textContent).toBe("My private work");
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenLastCalledWith(11, "post-1", '"post-v2"', expect.objectContaining({
      editor_document: { schema_version: 1, html: "<p>My private work</p>" },
    })));
  });

  it("surfaces editor_document field errors on the draft editor", async () => {
    updateSitePost.mockResolvedValue({ ok: false, error: { status: 400, code: "validation_error", message: "Invalid article.", details: { editor_document: { html: ["Article HTML must contain at most 200000 UTF-8 bytes."] } }, requestId: "bad-doc" } });
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByText(/Article HTML must contain at most 200000 UTF-8 bytes/);
    expect(screen.getByRole("heading", { name: "Edit Post" })).toBeTruthy();
  });

  it("fills the permalink from the title until the slug is edited", async () => {
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Post" });
    const title = screen.getByRole("textbox", { name: "Title" });
    const slug = screen.getByRole("textbox", { name: "Permalink slug" });
    fireEvent.change(title, { target: { value: "Welcome to the University of Gondar" } });
    expect(slug).toHaveProperty("value", "welcome-to-the-university-of-gondar");
    expect(screen.getByText(/Public path: \/posts\/welcome-to-the-university-of-gondar/)).toBeTruthy();
    fireEvent.change(slug, { target: { value: "uog-welcome" } });
    fireEvent.change(title, { target: { value: "Welcome to UoG" } });
    expect(slug).toHaveProperty("value", "uog-welcome");
  });

  it("rejects reserved permalinks and shows the public path preview", async () => {
    renderEditor("create");
    await screen.findByRole("heading", { name: "Create Post" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Reserved" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "admin" } });
    expect(screen.getByText(/"admin" is reserved/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(createSitePost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "campus-update" } });
    expect(screen.getByText(/Public path: \/posts\/campus-update/)).toBeTruthy();
  });

  it("surfaces duplicate slug API field errors on the settings panel", async () => {
    updateSitePost.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: "validation_error",
        message: "Invalid permalink.",
        details: { slug: ["A post with this slug already exists in this Site and language. Choose a different slug."] },
        requestId: "dup-slug",
      },
    });
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await screen.findByText(/already exists in this Site/);
    fireEvent.change(screen.getByRole("textbox", { name: "Permalink slug" }), { target: { value: "corrected-slug" } });
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", false);
    updateSitePost.mockResolvedValue(result(post({ slug: "corrected-slug" })));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenLastCalledWith(11, "post-1", '"post-v1"', expect.objectContaining({ slug: "corrected-slug" })));
  });

  it("locks Post settings while the Post is published", async () => {
    getSitePost.mockResolvedValue(result({ ...post({ status: "PUBLISHED" }), etag: '"post-v1"', editor_document: { schema_version: 1, html: "<p>Post body</p>" } }));
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    expect(screen.getByText(/locked while this Post is published/i)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("textbox", { name: "Permalink slug" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", true);
  });

  it("lets an editor remove selected taxonomy that is no longer eligible", async () => {
    getSitePost.mockResolvedValue(result({ ...post({ categories: ["missing-category"], tags: ["missing-tag"] }), etag: '"post-v1"', editor_document: { schema_version: 1, html: "<p>Post body</p>" } }));
    renderEditor("edit", { postId: "post-1" });
    await screen.findByRole("heading", { name: "Edit Post" });
    await screen.findByText(/Some selected categories or tags are unavailable/);
    for (const [label, option] of [["Categories", "Unavailable category (missing-category)"], ["Tags", "Unavailable tag (missing-tag)"]] as const) {
      fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
      fireEvent.click(await screen.findByRole("option", { name: option }));
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    }
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenCalledWith(11, "post-1", '"post-v1"', expect.objectContaining({ categories: [], tags: [] })));
  });
});
