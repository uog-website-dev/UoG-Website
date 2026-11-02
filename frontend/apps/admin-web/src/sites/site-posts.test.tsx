import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { SitePostRecord } from "@/app/sites/post-actions";

const loadSitePosts = vi.fn();
const loadSiteTaxonomy = vi.fn();
const createSiteTaxonomy = vi.fn();
const getSitePost = vi.fn();
const createSitePost = vi.fn();
const updateSitePost = vi.fn();
const transitionSitePost = vi.fn();

vi.mock("@/app/sites/post-actions", () => ({
  loadSitePosts: (...args: unknown[]) => loadSitePosts(...args),
  loadSiteTaxonomy: (...args: unknown[]) => loadSiteTaxonomy(...args),
  createSiteTaxonomy: (...args: unknown[]) => createSiteTaxonomy(...args),
  getSitePost: (...args: unknown[]) => getSitePost(...args),
  createSitePost: (...args: unknown[]) => createSitePost(...args),
  updateSitePost: (...args: unknown[]) => updateSitePost(...args),
  transitionSitePost: (...args: unknown[]) => transitionSitePost(...args),
}));

import { SitePostsPanel } from "./site-posts";

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

beforeEach(() => {
  loadSitePosts.mockReset();
  loadSiteTaxonomy.mockReset();
  createSiteTaxonomy.mockReset();
  getSitePost.mockReset();
  createSitePost.mockReset();
  updateSitePost.mockReset();
  transitionSitePost.mockReset();
  loadSitePosts.mockResolvedValue(list([post()]));
  loadSiteTaxonomy.mockImplementation(async (siteId: number, kind: "categories" | "tags") => result(
    (siteId === 11 ? (kind === "categories" ? [category] : [tag]) : []).map((row) => ({ ...row, site: siteId })),
  ));
  getSitePost.mockResolvedValue(result({ ...post(), etag: '"post-v1"' }));
  createSitePost.mockResolvedValue(result(post({ id: "post-2" })));
  updateSitePost.mockResolvedValue(result(post()));
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
    for (const [label, option] of [["Status", "Published"], ["Category", "News"], ["Tag", "Campus"]]) {
      fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
      fireEvent.click(await screen.findByRole("option", { name: option }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(11, {
      search: "campus", status: "PUBLISHED", category: category.id, tag: tag.id,
      page: 1, page_size: 20, ordering: "-created_at",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(11, {
      search: undefined, status: undefined, category: undefined, tag: undefined,
      page: 1, page_size: 20, ordering: "-created_at",
    }));
  });

  it("resets filters on Site change and requests the new Site only", async () => {
    const view = renderPanel();
    await screen.findByRole("table", { name: "Posts for this Site" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search Posts" }), { target: { value: "private" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Published" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(11, expect.objectContaining({ search: "private", status: "PUBLISHED" })));

    view.rerender(<ToastProvider><SitePostsPanel siteId={22} postsEnabled permissions={PERMISSIONS} /></ToastProvider>);
    expect((screen.getByRole("textbox", { name: "Search Posts" }) as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(loadSitePosts).toHaveBeenLastCalledWith(22, {
      search: undefined, status: undefined, category: undefined, tag: undefined,
      page: 1, page_size: 20, ordering: "-created_at",
    }));
    expect(loadSiteTaxonomy).toHaveBeenCalledWith(22, "categories");
  });

  it("hides create/edit actions without permissions and blocks the disabled module", async () => {
    renderPanel(11, true, ["content.posts.view"]);
    await screen.findByRole("table", { name: "Posts for this Site" });
    expect(screen.queryByRole("button", { name: "Create Post" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Campus update" })).toBeNull();

    loadSitePosts.mockClear();
    renderPanel(22, false, PERMISSIONS);
    expect(await screen.findByText(/Posts are disabled for this Site/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Post" })).toBeNull();
    expect(loadSitePosts).not.toHaveBeenCalled();
  });

  it("does not request or reveal Site Posts without view permission", async () => {
    renderPanel(11, true, []);
    expect(await screen.findByText("You do not have permission to view Posts for this Site.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Posts for this Site" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Post" })).toBeNull();
    expect(loadSitePosts).not.toHaveBeenCalled();
    expect(loadSiteTaxonomy).not.toHaveBeenCalled();
  });

  it("creates drafts and edits with the detail ETag", async () => {
    renderPanel();
    await screen.findByRole("table", { name: "Posts for this Site" });
    fireEvent.click(screen.getByRole("button", { name: "Create Post" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "New campus story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Slug" }), { target: { value: "new-campus-story" } });
    fireEvent.click(screen.getByRole("button", { name: "Add paragraph" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Block 1 JSON" }), { target: { value: '{"type":"paragraph","html":"<p>Story body</p>"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(createSitePost).toHaveBeenCalledWith(11, expect.objectContaining({
      title: "New campus story", slug: "new-campus-story", content: "Story body",
      blocks: [{ type: "paragraph", html: "<p>Story body</p>" }], seo: {},
    })));

    fireEvent.click(await screen.findByRole("button", { name: "Edit Campus update" }));
    expect(await screen.findByRole("dialog", { name: "Edit Post" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateSitePost).toHaveBeenCalledWith(11, "post-1", '"post-v1"', expect.any(Object)));
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

  it("validates media scope and offers taxonomy creation only to authorized creators", async () => {
    const view = renderPanel(11, true, ["content.posts.view"]);
    await screen.findByRole("table", { name: "Posts for this Site" });
    expect(screen.queryByRole("button", { name: "Create category" })).toBeNull();

    view.rerender(<ToastProvider><SitePostsPanel siteId={11} postsEnabled permissions={PERMISSIONS} /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Post" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Create Post" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Scoped story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Slug" }), { target: { value: "Bad Slug" } });
    expect(screen.getByText("Use lowercase letters and numbers separated by single hyphens.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Slug" }), { target: { value: "scoped-story" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Featured image reference" }), { target: { value: "sites/22/foreign.jpg" } });
    expect(screen.getByText(/External and other-Site media are not allowed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create draft" })).toHaveProperty("disabled", true);

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
    renderPanel();
    await screen.findByRole("table", { name: "Posts for this Site" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Campus update" }));
    await screen.findByRole("dialog", { name: "Edit Post" });
    fireEvent.change(screen.getByRole("textbox", { name: "Block 1 JSON" }), {
      target: { value: '{"type":"paragraph","html":"<p>Safe<script>alert(1)</script><a href=\\\"javascript:alert(2)\\\">bad</a></p>"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
    const preview = await screen.findByRole("region", { name: "Private Post preview" });
    expect(preview.textContent).toContain("Safe");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("a")).toBeNull();
    expect(preview.textContent).not.toContain("javascript:");
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(transitionSitePost).toHaveBeenCalledWith(11, postId, "submit", ""));

    view.unmount();
    loadSitePosts.mockResolvedValue(list([post({ id: postId, status: "APPROVED", available_actions: ["publish"] })]));
    renderPanel(11, true, [...PERMISSIONS, "content.posts.publish"]);
    fireEvent.click(await screen.findByRole("button", { name: "Publish Campus update" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(transitionSitePost).toHaveBeenCalledWith(11, postId, "publish", ""));
    expect(screen.queryByRole("button", { name: "Submit Campus update for review" })).toBeNull();
  });
});
