import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const loadSitePages = vi.fn();
const loadSitePageStatusCounts = vi.fn();
const getSitePage = vi.fn();
const createSitePage = vi.fn();
const updateSitePage = vi.fn();
const transitionSitePage = vi.fn();
const setSiteHomepage = vi.fn();
const loadSitePageWorkflowHistory = vi.fn();
const openWorkingDraft = vi.fn();

const mediaMocks = vi.hoisted(() => ({
  listSiteMedia: vi.fn(),
  getMediaUploadPolicy: vi.fn(),
  getSiteMedia: vi.fn(),
  updateSiteMedia: vi.fn(),
  getMediaReferences: vi.fn(),
  removeSiteMedia: vi.fn(),
}));

vi.mock("@/app/sites/page-actions", () => ({
  loadSitePages: (...args: unknown[]) => loadSitePages(...args),
  loadSitePageStatusCounts: (...args: unknown[]) => loadSitePageStatusCounts(...args),
  getSitePage: (...args: unknown[]) => getSitePage(...args),
  createSitePage: (...args: unknown[]) => createSitePage(...args),
  updateSitePage: (...args: unknown[]) => updateSitePage(...args),
  transitionSitePage: (...args: unknown[]) => transitionSitePage(...args),
  loadSitePageWorkflowHistory: (...args: unknown[]) => loadSitePageWorkflowHistory(...args),
  openWorkingDraft: (...args: unknown[]) => openWorkingDraft(...args),
  setSiteHomepage: (...args: unknown[]) => setSiteHomepage(...args),
}));

vi.mock("@/app/sites/media-actions", () => mediaMocks);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/sites/11/admin/pages",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { SitePagesPanel } from "./site-pages";

const assetId = "11111111-1111-4111-8111-111111111111";
const ready = {
  id: assetId,
  site: 11,
  original_filename: "campus.png",
  detected_mime: "image/png",
  content_type: "image/png",
  byte_count: 100,
  checksum: "abc",
  status: "READY" as const,
  processing_state: "READY" as const,
  thumbnail_status: "READY" as const,
  thumbnail_url: "/thumb",
  processing_attempts: 1,
  processing_error_code: "",
  width: 800,
  height: 600,
  alt_text: "Campus green",
  created_by: 1,
  updated_by: 1,
  created_at: "2026-11-11T00:00:00Z",
  updated_at: "2026-11-11T00:00:00Z",
};

const pageRecord = {
  id: "page-1",
  site: 11,
  parent: null,
  title: "Admissions",
  slug: "admissions",
  path: "/admissions",
  status: "DRAFT" as const,
  visibility: "PUBLIC" as const,
  locale: "en-us",
  is_homepage: false,
  created_by: 7,
  updated_at: "2026-03-20T10:00:00Z",
  etag: '"cms-content-page-1-r1"',
  blocks: [{
    type: "image",
    id: "img-1",
    ref: `sites/11/assets/${assetId}`,
    alt: "Campus green",
  }],
  available_actions: ["submit"] as const,
  metadata: {},
  seo: {},
};

beforeEach(() => {
  loadSitePages.mockResolvedValue({ ok: true, data: { count: 1, next: null, previous: null, results: [pageRecord] } });
  loadSitePageStatusCounts.mockResolvedValue({
    ok: true,
    data: { DRAFT: 1, IN_REVIEW: 0, APPROVED: 0, PUBLISHED: 0, UNPUBLISHED: 0, ARCHIVED: 0 },
  });
  getSitePage.mockResolvedValue({ ok: true, data: pageRecord });
  updateSitePage.mockResolvedValue({
    ok: false,
    error: { status: 400, code: "validation_error", message: "Only a ready image owned by this Site may be selected.", details: null, requestId: null },
  });
  mediaMocks.listSiteMedia.mockResolvedValue({ ok: true, data: { count: 1, next: null, previous: null, results: [ready] } });
  mediaMocks.getSiteMedia.mockResolvedValue({ ok: true, data: ready });
  mediaMocks.getMediaUploadPolicy.mockResolvedValue({
    ok: true,
    data: { image_max_bytes: 1, text_max_bytes: 1, pdf_max_bytes: 1, mime_types: ["image/png"] },
  });
});

describe("CMS media picker save integration", () => {
  it("keeps the draft image selection when save finds the asset ineligible", async () => {
    render(
      <ToastProvider>
        <SitePagesPanel
          siteId={11}
          pagesEnabled
          permissions={["content.pages.view", "content.pages.update", "content.media.view", "content.media.upload"]}
        />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Admissions" }));
    expect(await screen.findByText(`Asset ID: ${assetId}`)).toBeTruthy();
    expect(screen.getByDisplayValue("Campus green")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Only a ready image owned by this Site may be selected/i)).toBeTruthy();
    expect(screen.getByText(`Asset ID: ${assetId}`)).toBeTruthy();
    expect(screen.getByDisplayValue("Campus green")).toBeTruthy();
    expect((screen.getByLabelText("Block 1 JSON") as HTMLInputElement).value).toContain(assetId);
  });
});
