import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SitePageRecord } from "@/app/sites/page-actions";
import { SiteAdminFrame, SiteSection } from "./site-admin-frame";
import { SiteHomepagePanel } from "./site-homepage";

const getSite = vi.fn();
const loadSitePages = vi.fn();
const getSitePage = vi.fn();
const setSiteHomepage = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/app/sites/actions", () => ({
  getSite: (...args: unknown[]) => getSite(...args),
}));
vi.mock("@/app/sites/page-actions", () => ({
  loadSitePages: (...args: unknown[]) => loadSitePages(...args),
  getSitePage: (...args: unknown[]) => getSitePage(...args),
  setSiteHomepage: (...args: unknown[]) => setSiteHomepage(...args),
}));
vi.mock("@uog/ui", async () => {
  const actual = await vi.importActual<typeof import("@uog/ui")>("@uog/ui");
  return { ...actual, useToast: () => toast };
});

function page(values: Partial<SitePageRecord> = {}): SitePageRecord {
  return {
    id: "page-1",
    site: 11,
    title: "Campus Home",
    slug: "home",
    path: "/",
    parent: null,
    status: "PUBLISHED",
    visibility: "PUBLIC",
    locale: "en-us",
    is_homepage: false,
    can_set_homepage: true,
    created_by: 7,
    updated_at: "2026-11-12T00:00:00Z",
    blocks: [],
    metadata: {},
    seo: {},
    etag: '"1"',
    revision_number: 4,
    ...values,
  };
}

function renderPanel(site: { id: number; name: string; homepageId?: string | null } = { id: 11, name: "Informatics", homepageId: null }) {
  return render(
    <SiteAdminFrame
      site={{
        id: site.id,
        name: site.name,
        code: site.id === 11 ? "CI" : "CM",
        status: "ACTIVE",
        primaryDomain: { hostname: site.id === 11 ? "informatics.example.test" : "medicine.example.test", status: "ACTIVE" },
        homepageId: site.homepageId ?? null,
      }}
      enabledModuleCodes={["PAGES", "VISUAL_BUILDER"]}
      permissions={["sites.update", "content.pages.view", "content.pages.update"]}
    >
      <SiteSection sectionKey="homepage">
        <SiteHomepagePanel />
      </SiteSection>
    </SiteAdminFrame>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSite.mockResolvedValue({ ok: true, data: { data: { id: 11, homepage: null }, etag: '"site-1"' } });
  loadSitePages.mockResolvedValue({
    ok: true,
    data: { count: 1, next: null, previous: null, results: [page()] },
  });
  setSiteHomepage.mockResolvedValue({ ok: true, data: page({ is_homepage: true }) });
});

describe("Homepage Settings", () => {
  it("lists only eligible same-Site published Pages and assigns with authoritative success", async () => {
    loadSitePages.mockResolvedValue({
      ok: true,
      data: {
        count: 3,
        next: null,
        previous: null,
        results: [
          page(),
          page({ id: "page-2", title: "Draft News", status: "DRAFT", can_set_homepage: false, path: "/news" }),
          page({ id: "page-3", site: 22, title: "Medicine Home", can_set_homepage: true, path: "/medicine" }),
        ],
      },
    });
    renderPanel();
    expect(await screen.findByRole("heading", { name: "Homepage Settings" })).toBeTruthy();
    expect(screen.getByText(/Informatics · CI · informatics.example.test/)).toBeTruthy();
    const select = await screen.findByRole("combobox", { name: "Eligible Page" });
    fireEvent.mouseDown(select);
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent).join("|")).toContain("Campus Home");
    expect(options.map((option) => option.textContent).join("|")).not.toContain("Draft News");
    expect(options.map((option) => option.textContent).join("|")).not.toContain("Medicine Home");
    fireEvent.click(within(screen.getByRole("listbox")).getByText(/Campus Home/));
    fireEvent.click(screen.getByRole("button", { name: "Assign homepage" }));
    await waitFor(() => expect(setSiteHomepage).toHaveBeenCalledWith(11, "page-1"));
    expect(await screen.findByText(/is now the homepage for Informatics/)).toBeTruthy();
    expect(toast.success).toHaveBeenCalled();
  });

  it("keeps the confirmed selection when eligibility is lost between list and submit", async () => {
    setSiteHomepage.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: "validation_error",
        message: "Select an eligible published Page on this Site.",
        details: { homepage: ["Select an eligible published Page on this Site."] },
        requestId: null,
      },
    });
    renderPanel();
    expect(await screen.findByRole("button", { name: "Assign homepage" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign homepage" }));
    expect(await screen.findByText(/Your selection is unchanged/)).toBeTruthy();
    expect(screen.getByText(/Campus Home · \//)).toBeTruthy();
  });

  it("shows fallback state when the assigned Page is no longer published", async () => {
    getSite.mockResolvedValue({ ok: true, data: { data: { id: 11, homepage: "page-9" }, etag: '"site-2"' } });
    loadSitePages.mockResolvedValue({ ok: true, data: { count: 0, next: null, previous: null, results: [] } });
    getSitePage.mockResolvedValue({
      ok: true,
      data: page({ id: "page-9", title: "Former Home", status: "UNPUBLISHED", is_homepage: true, can_set_homepage: false, path: "/former" }),
    });
    renderPanel({ id: 11, name: "Informatics", homepageId: "page-9" });
    expect(await screen.findByText(/Former Home/)).toBeTruthy();
    expect(screen.getByText(/no longer eligible for public root delivery/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Page editor" }).getAttribute("href")).toBe("/sites/11/admin/pages/page-9/builder");
  });

  it("resets assignment context when switching Sites", async () => {
    getSite.mockImplementation(async (siteId: number) => ({
      ok: true,
      data: {
        data: { id: siteId, homepage: siteId === 11 ? "page-1" : "page-m" },
        etag: `"site-${siteId}"`,
      },
    }));
    loadSitePages.mockImplementation(async (siteId: number) => ({
      ok: true,
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          siteId === 11
            ? page({ id: "page-1", title: "Informatics Home", is_homepage: true, can_set_homepage: true })
            : page({ id: "page-m", site: 22, title: "Medicine Home", is_homepage: true, can_set_homepage: true, path: "/" }),
        ],
      },
    }));
    const view = renderPanel({ id: 11, name: "Informatics", homepageId: "page-1" });
    expect(await screen.findByText((content, element) => element?.tagName === "STRONG" && content === "Informatics Home")).toBeTruthy();
    view.unmount();
    renderPanel({ id: 22, name: "Medicine", homepageId: "page-m" });
    expect(await screen.findByText(/Medicine · CM · medicine.example.test/)).toBeTruthy();
    expect(await screen.findByText((content, element) => element?.tagName === "STRONG" && content === "Medicine Home")).toBeTruthy();
    expect(screen.queryByText((content, element) => element?.tagName === "STRONG" && content === "Informatics Home")).toBeNull();
    expect(screen.getByRole("link", { name: /Public Preview for Medicine/ })).toBeTruthy();
  });
});
