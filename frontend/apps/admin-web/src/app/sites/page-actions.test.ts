import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    getDetailed: vi.fn(),
    post: vi.fn(),
    postDetailed: vi.fn(),
    patchDetailed: vi.fn(),
    delDetailed: vi.fn(),
  },
}));

vi.mock("@uog/api-client", () => ({
  createApiClient: vi.fn(() => api),
}));

vi.mock("@/access-token", () => ({
  getAccessToken: vi.fn(async () => "server-token"),
}));

import {
  createSitePage,
  getSitePage,
  loadSitePages,
  loadSitePageStatusCounts,
  updateSitePage,
} from "./page-actions";

const record = {
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
  blocks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Site Page API actions", () => {
  it("uses the site-scoped list contract with encoded filters and returns pagination", async () => {
    api.get.mockResolvedValue({
      count: 21,
      next: "http://backend/api/v1/sites/11/pages/?page=2",
      previous: null,
      results: [record, { ...record, id: "foreign-page", site: 22 }],
    });

    const result = await loadSitePages(11, {
      search: "admissions & outreach",
      status: "DRAFT",
      page: 2,
      page_size: 20,
      ordering: "-updated_at",
    });

    expect(api.get).toHaveBeenCalledWith(
      "/v1/sites/11/pages/?search=admissions+%26+outreach&status=DRAFT&page=2&page_size=20&ordering=-updated_at",
    );
    expect(result).toEqual({
      ok: true,
      data: {
        count: 21,
        next: "http://backend/api/v1/sites/11/pages/?page=2",
        previous: null,
        results: [record],
      },
    });
  });

  it("builds full-site status totals from the API's filtered count contract", async () => {
    api.get.mockImplementation(async (path: string) => {
      const status = new URL(`http://backend${path}`).searchParams.get("status");
      return { count: status === "PUBLISHED" ? 9 : 0, results: [] };
    });

    const result = await loadSitePageStatusCounts(11);

    expect(api.get).toHaveBeenCalledTimes(6);
    expect(api.get).toHaveBeenCalledWith("/v1/sites/11/pages/?status=DRAFT&page=1&page_size=1");
    expect(api.get).toHaveBeenCalledWith("/v1/sites/11/pages/?status=ARCHIVED&page=1&page_size=1");
    expect(result).toEqual({
      ok: true,
      data: {
        DRAFT: 0,
        IN_REVIEW: 0,
        APPROVED: 0,
        PUBLISHED: 9,
        UNPUBLISHED: 0,
        ARCHIVED: 0,
      },
    });
  });

  it("loads a scoped detail with its ETag and sends that ETag for updates", async () => {
    api.getDetailed.mockResolvedValue({ data: record, etag: '"cms-content-page-1-r4"' });
    const detail = await getSitePage(11, "page-1");

    expect(api.getDetailed).toHaveBeenCalledWith("/v1/sites/11/pages/page-1/");
    expect(detail).toEqual({ ok: true, data: { ...record, etag: '"cms-content-page-1-r4"' } });

    api.patchDetailed.mockResolvedValue({ data: { ...record, title: "Admissions updated" }, etag: '"cms-content-page-1-r5"' });
    const updated = await updateSitePage(11, "page-1", '"cms-content-page-1-r4"', {
      title: "Admissions updated",
      slug: "admissions",
      parent: null,
      visibility: "PUBLIC",
      metadata: {},
      seo: {},
      blocks: [],
    });

    expect(api.patchDetailed).toHaveBeenCalledWith(
      "/v1/sites/11/pages/page-1/",
      { title: "Admissions updated", slug: "admissions", parent: null, visibility: "PUBLIC", metadata: {}, seo: {}, blocks: [] },
      { ifMatch: '"cms-content-page-1-r4"' },
    );
    expect(updated).toMatchObject({ ok: true, data: { etag: '"cms-content-page-1-r5"' } });
  });

  it("sends structured blocks and same-site hierarchy in the create contract", async () => {
    api.postDetailed.mockResolvedValue({ data: record, etag: '"cms-content-page-1-r1"' });

    await createSitePage(11, {
      title: "Admissions",
      slug: "admissions",
      parent: null,
      locale: "en",
      visibility: "PUBLIC",
      metadata: {},
      seo: {},
      blocks: [{ type: "paragraph", html: "<p>Applications</p>" }],
    });

    expect(api.postDetailed).toHaveBeenCalledWith("/v1/sites/11/pages/", {
      title: "Admissions",
      slug: "admissions",
      parent: null,
      locale: "en",
      visibility: "PUBLIC",
      metadata: {},
      seo: {},
      blocks: [{ type: "paragraph", html: "<p>Applications</p>" }],
    });
  });
});
