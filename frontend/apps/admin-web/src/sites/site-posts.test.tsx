import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { SitePostRecord } from "@/app/sites/post-actions";

const loadSitePosts = vi.fn();
const loadSiteTaxonomy = vi.fn();
const getSitePost = vi.fn();
const createSitePost = vi.fn();
const updateSitePost = vi.fn();

vi.mock("@/app/sites/post-actions", () => ({
  loadSitePosts: (...args: unknown[]) => loadSitePosts(...args),
  loadSiteTaxonomy: (...args: unknown[]) => loadSiteTaxonomy(...args),
  getSitePost: (...args: unknown[]) => getSitePost(...args),
  createSitePost: (...args: unknown[]) => createSitePost(...args),
  updateSitePost: (...args: unknown[]) => updateSitePost(...args),
}));

import { SitePostsPanel } from "./site-posts";

const PERMISSIONS = ["content.posts.view", "content.posts.create", "content.posts.update"];
const category = { id: "category-1", site: 11, code: "NEWS", name: "News", slug: "news", is_active: true };
const tag = { id: "tag-1", site: 11, code: "CAMPUS", name: "Campus", slug: "campus", is_active: true };

function post(partial: Partial<SitePostRecord> = {}): SitePostRecord {
  return {
    id: "post-1", site: 11, title: "Campus update", slug: "campus-update",
    excerpt: "An update", content: "Post body", featured_media: "/media/campus.jpg",
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
  getSitePost.mockReset();
  createSitePost.mockReset();
  updateSitePost.mockReset();
  loadSitePosts.mockResolvedValue(list([post()]));
  loadSiteTaxonomy.mockImplementation(async (siteId: number, kind: "categories" | "tags") => result(
    (siteId === 11 ? (kind === "categories" ? [category] : [tag]) : []).map((row) => ({ ...row, site: siteId })),
  ));
  getSitePost.mockResolvedValue(result({ ...post(), etag: '"post-v1"' }));
  createSitePost.mockResolvedValue(result(post({ id: "post-2" })));
  updateSitePost.mockResolvedValue(result(post()));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Post content" }), { target: { value: "Story body" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(createSitePost).toHaveBeenCalledWith(11, expect.objectContaining({
      title: "New campus story", slug: "new-campus-story", content: "Story body",
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
});
