import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSitePageStatusCounts = vi.fn();
const loadSitePosts = vi.fn();
const loadSiteNavigation = vi.fn();

vi.mock("@/app/sites/page-actions", () => ({
  loadSitePageStatusCounts: (...args: unknown[]) => loadSitePageStatusCounts(...args),
}));
vi.mock("@/app/sites/post-actions", () => ({
  loadSitePosts: (...args: unknown[]) => loadSitePosts(...args),
}));
vi.mock("@/app/sites/menu-actions", () => ({
  loadSiteNavigation: (...args: unknown[]) => loadSiteNavigation(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/sites/11/admin",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { SiteAdminFrame } from "./site-admin-frame";
import { SiteDashboard } from "./site-dashboard";

const SITE = { id: 11, name: "Informatics", code: "INFORMATICS", status: "ACTIVE" as const };

function renderDashboard(enabledModuleCodes: string[], permissions: string[]) {
  return render(
    <SiteAdminFrame site={SITE} enabledModuleCodes={enabledModuleCodes} permissions={permissions}>
      <SiteDashboard />
    </SiteAdminFrame>,
  );
}

function postCount(count: number) {
  return { ok: true, data: { count, next: null, previous: null, results: [] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSitePageStatusCounts.mockResolvedValue({
    ok: true,
    data: { DRAFT: 2, IN_REVIEW: 1, APPROVED: 0, PUBLISHED: 4, UNPUBLISHED: 0, ARCHIVED: 1 },
  });
  loadSitePosts.mockImplementation(async (_site: number, query: { status?: string }) =>
    postCount(query.status === "PUBLISHED" ? 3 : query.status ? 1 : 5));
  loadSiteNavigation.mockResolvedValue({
    ok: true,
    data: {
      inheritance: [],
      menus: [
        { menu: { id: "m1", site: 11, location: "header", name: "Header", is_active: true, is_global: false }, items: [{}, {}], etag: "" },
        { menu: { id: "m2", site: 11, location: "footer", name: "Footer", is_active: false, is_global: false }, items: [{}], etag: "" },
        { menu: { id: "g", site: null, location: "header", name: "Central", is_active: true, is_global: true }, items: [{}], etag: "" },
      ],
    },
  });
});

const ALL = [
  "content.pages.view", "content.pages.create",
  "content.posts.view",
  "menu.read", "menu.write",
];

describe("SiteDashboard", () => {
  it("summarizes this Site's Pages, Posts and Menus from the API", async () => {
    renderDashboard(["PAGES", "POSTS", "MENUS"], ALL);

    const pages = await screen.findByRole("region", { name: "Pages" });
    await waitFor(() => expect(within(pages).getByText("8")).toBeTruthy());
    expect(within(pages).getByText("4")).toBeTruthy();
    const posts = screen.getByRole("region", { name: "Posts" });
    await waitFor(() => expect(within(posts).getByText("5")).toBeTruthy());
    expect(within(posts).getByText("3")).toBeTruthy();
    const menus = screen.getByRole("region", { name: "Menus" });
    // Two local menus, one active, three items; the central menu is not counted.
    await waitFor(() => expect(within(menus).getByText("3")).toBeTruthy());
    expect(within(menus).getByText("2")).toBeTruthy();

    expect(loadSitePageStatusCounts).toHaveBeenCalledWith(11);
    expect(loadSitePosts).toHaveBeenCalledWith(11, { page: 1, page_size: 1 });
    expect(loadSitePosts).toHaveBeenCalledWith(11, { status: "PUBLISHED", page: 1, page_size: 1 });
    expect(loadSiteNavigation).toHaveBeenCalledWith(11);
  });

  it("offers create-page and navigation quick actions within the Site", async () => {
    renderDashboard(["PAGES", "MENUS"], ALL);
    expect(screen.getByRole("link", { name: "Create page" }).getAttribute("href")).toBe("/sites/11/admin/pages?create=1");
    expect(screen.getByRole("link", { name: "Manage navigation" }).getAttribute("href")).toBe("/sites/11/admin/menus");
    await screen.findByRole("region", { name: "Pages" });
  });

  it("omits disabled or unauthorized sections and does not call their APIs", async () => {
    renderDashboard(["PAGES"], ["content.pages.view", "content.posts.view"]);
    await screen.findByRole("region", { name: "Pages" });
    expect(screen.queryByRole("region", { name: "Posts" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Menus" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create page" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage navigation" })).toBeNull();
    expect(screen.getByText(/Not enabled for this Site: Posts\./)).toBeTruthy();
    expect(loadSitePosts).not.toHaveBeenCalled();
    expect(loadSiteNavigation).not.toHaveBeenCalled();
  });

  it("shows an empty state when the Site has no Pages", async () => {
    loadSitePageStatusCounts.mockResolvedValue({
      ok: true,
      data: { DRAFT: 0, IN_REVIEW: 0, APPROVED: 0, PUBLISHED: 0, UNPUBLISHED: 0, ARCHIVED: 0 },
    });
    renderDashboard(["PAGES"], ["content.pages.view"]);
    expect(await screen.findByText("This Site has no Pages yet.")).toBeTruthy();
  });

  it("reports a failed summary and retries it", async () => {
    loadSiteNavigation.mockResolvedValueOnce({
      ok: false,
      error: { status: 403, code: "permission_denied", message: "Not allowed", details: null, requestId: null },
    });
    renderDashboard(["MENUS"], ["menu.read"]);
    expect(await screen.findByText(/Menus could not be summarized: Not allowed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loadSiteNavigation).toHaveBeenCalledTimes(2));
  });

  it("says so when no content module is available", () => {
    renderDashboard([], []);
    expect(screen.getByText("No content modules are available to you for this Site.")).toBeTruthy();
  });
});
