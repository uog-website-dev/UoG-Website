import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { SitePageRecord } from "@/app/sites/page-actions";

const loadSitePages = vi.fn();
const createSitePage = vi.fn();
const updateSitePage = vi.fn();
const transitionSitePage = vi.fn();
const setSiteHomepage = vi.fn();

vi.mock("@/app/sites/page-actions", () => ({
  loadSitePages: (...args: unknown[]) => loadSitePages(...args),
  createSitePage: (...args: unknown[]) => createSitePage(...args),
  updateSitePage: (...args: unknown[]) => updateSitePage(...args),
  transitionSitePage: (...args: unknown[]) => transitionSitePage(...args),
  setSiteHomepage: (...args: unknown[]) => setSiteHomepage(...args),
}));

import { SitePagesPanel } from "./site-pages";

function draft(partial: Partial<SitePageRecord> = {}): SitePageRecord {
  return {
    id: "page-1",
    site: 11,
    title: "Admissions",
    slug: "admissions",
    path: "/admissions",
    status: "DRAFT",
    is_homepage: false,
    etag: '"cms-content-page-1-r1"',
    blocks: [{
      type: "paragraph",
      html: "<p>Hello<script>alert(1)</script> <a href=\"javascript:alert(2)\">Bad</a> <a href=\"/about\">About</a></p>",
    }],
    ...partial,
  };
}

function renderPanel(siteId = 11, pagesEnabled: boolean | null = true) {
  return render(
    <ToastProvider>
      <SitePagesPanel siteId={siteId} pagesEnabled={pagesEnabled} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSitePages.mockResolvedValue({ ok: true, data: [draft()] });
  createSitePage.mockResolvedValue({ ok: true, data: draft() });
  transitionSitePage.mockResolvedValue({ ok: true, data: draft({ status: "IN_REVIEW" }) });
  setSiteHomepage.mockResolvedValue({ ok: true, data: draft({ is_homepage: true }) });
  updateSitePage.mockResolvedValue({ ok: true, data: draft({ title: "Admissions updated" }) });
});

describe("SitePagesPanel", () => {
  it("submits this Site's draft for review and previews it without unsafe links", async () => {
    renderPanel(11);
    const submit = await screen.findByRole("button", { name: "Submit Admissions for review" });
    expect(submit.tagName).toBe("BUTTON");
    submit.focus();
    expect(document.activeElement).toBe(submit);
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
    fireEvent.click(submit);
    await waitFor(() => expect(transitionSitePage).toHaveBeenCalledWith(11, "page-1", "submit"));
    expect(JSON.stringify(transitionSitePage.mock.calls)).not.toContain("22");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("creates and assigns the homepage only for this Site", async () => {
    renderPanel(11);
    fireEvent.click(await screen.findByRole("button", { name: "Create page" }));
    await waitFor(() => expect(createSitePage).toHaveBeenCalledWith(11, {
      title: "Admissions",
      slug: "admissions",
      text: "Applications are open.",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Set Admissions as homepage" }));
    await waitFor(() => expect(setSiteHomepage).toHaveBeenCalledWith(11, "page-1"));
    expect(JSON.stringify(createSitePage.mock.calls)).not.toContain("22");
  });

  it("hides another Site's page even if the payload includes it", async () => {
    loadSitePages.mockResolvedValue({
      ok: true,
      data: [draft(), draft({ id: "page-9", site: 22, title: "Hospital" })],
    });
    renderPanel(11);
    expect((await screen.findAllByText("Admissions")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("blocks management when the PAGES module is off", async () => {
    renderPanel(11, false);
    const submit = await screen.findByRole("button", { name: "Submit Admissions for review" });
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Create page" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/public website does not serve pages/)).toBeTruthy();
    fireEvent.click(submit);
    expect(transitionSitePage).not.toHaveBeenCalled();
  });
});
