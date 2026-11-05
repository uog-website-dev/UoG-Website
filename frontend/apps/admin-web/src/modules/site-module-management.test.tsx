import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModuleActivationSummary, SiteActivationRow } from "./bulk-contract";

const listSiteModuleActivation = vi.fn();
const previewModuleOperation = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/modules/actions", () => ({
  listSiteModuleActivation: (...args: unknown[]) => listSiteModuleActivation(...args),
  previewModuleOperation: (...args: unknown[]) => previewModuleOperation(...args),
  applyModuleOperation: vi.fn(),
}));
vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

import { SiteModuleManagement } from "./site-module-management";

const MODULES: ModuleActivationSummary[] = ["PAGES", "POSTS"].map((code, index): ModuleActivationSummary => ({
  id: index + 1, code, name: code, description: "", status: "IMPLEMENTED", implementation_status: "AVAILABLE",
  is_shipped: true, platform_enabled: true, enabled_sites: 1, disabled_sites: 0, eligible_sites: 3, total_sites: 3,
  requires: [], required_by: [], updated_at: "2026-11-04T00:00:00Z",
})).concat([{
  id: 9, code: "EVENTS", name: "Events", description: "", status: "PLANNED", implementation_status: "PLANNED",
  is_shipped: false, platform_enabled: false, enabled_sites: 0, disabled_sites: 0, eligible_sites: 0, total_sites: 3,
  requires: [], required_by: [], updated_at: "2026-11-04T00:00:00Z",
}]);

function site(id: number, code: string, modules: SiteActivationRow["modules"] = {}): SiteActivationRow {
  return { id, code, name: `${code} Site`, status: "ACTIVE", organization: { id: 6, code: "CI", name: "Informatics" }, modules };
}

const ROWS = [site(2, "INF", { PAGES: "ENABLED" }), site(3, "MED", { PAGES: "ENABLED", POSTS: "DISABLED" })];

function page(results: SiteActivationRow[], count = results.length) {
  return { ok: true, data: { count, next: null, previous: null, results } };
}

function renderScreen() {
  const props = { modules: MODULES, onApplied: vi.fn(), onShowHistory: vi.fn() };
  render(<SiteModuleManagement {...props} />);
  return props;
}

async function chooseModule(name: RegExp) {
  fireEvent.mouseDown(screen.getByLabelText("Modules"));
  fireEvent.click(await screen.findByRole("option", { name }));
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
}

beforeEach(() => {
  vi.clearAllMocks();
  listSiteModuleActivation.mockResolvedValue(page(ROWS));
  getOrganizationTree.mockResolvedValue({
    ok: true,
    data: {
      count: 2,
      results: [
        { id: 5, code: "UOG", name: "University", parent: null },
        { id: 6, code: "CI", name: "Informatics", parent: 5 },
      ],
    },
  });
  previewModuleOperation.mockResolvedValue({ ok: false, error: { status: 400, code: "x", message: "stop", details: null, requestId: null } });
});

describe("SiteModuleManagement", () => {
  it("shows each Site's activation from the backend, with planned modules left out", async () => {
    renderScreen();
    const table = await screen.findByRole("table", { name: "Sites and module activation" });
    await within(table).findByText("INF Site");
    const med = within(table).getAllByRole("row").find((row) => row.textContent?.includes("MED Site"));
    expect(med?.textContent).toContain("Enabled");
    expect(med?.textContent).toContain("Disabled");
    const inf = within(table).getAllByRole("row").find((row) => row.textContent?.includes("INF Site"));
    expect(inf?.textContent).toContain("Not assigned");
    expect(within(table).queryByText("EVENTS")).toBeNull();
  });

  it("previews exactly the visibly selected Sites", async () => {
    renderScreen();
    await screen.findByText("INF Site");
    expect(screen.getByRole("button", { name: "Preview enable" })).toHaveProperty("disabled", true);
    await chooseModule(/POSTS · POSTS/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INF Site" }));
    expect(screen.getByText(/POSTS on INF Site/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select MED Site" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview enable" }));
    await waitFor(() =>
      expect(previewModuleOperation).toHaveBeenCalledWith({
        action: "ENABLE", modules: ["POSTS"], scope: { type: "SELECTED", site_ids: [2, 3] },
      }),
    );
  });

  it("uses one Site scope for a single selection", async () => {
    renderScreen();
    await screen.findByText("INF Site");
    await chooseModule(/PAGES · PAGES/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select MED Site" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview disable" }));
    await waitFor(() =>
      expect(previewModuleOperation).toHaveBeenCalledWith({
        action: "DISABLE", modules: ["PAGES"], scope: { type: "SITE", site_ids: [3] },
      }),
    );
  });

  it("distinguishes the visible page from every matching Site", async () => {
    listSiteModuleActivation.mockResolvedValue(page(ROWS, 45));
    renderScreen();
    await screen.findByText("INF Site");
    fireEvent.change(screen.getByLabelText("Site"), { target: { value: "med" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(listSiteModuleActivation).toHaveBeenLastCalledWith({ search: "med", page: 1 }));
    await screen.findByText("INF Site");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select every Site on this page" }));
    expect(screen.getByText("All 2 Sites on this page are selected. Sites on other pages are not.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use all 45 matching Sites" }));
    expect(screen.getByText(/targets all 45 Sites matching the filters, including Sites on other pages/)).toBeTruthy();

    await chooseModule(/POSTS · POSTS/);
    fireEvent.click(screen.getByRole("button", { name: "Preview enable" }));
    await waitFor(() =>
      expect(previewModuleOperation).toHaveBeenCalledWith({
        action: "ENABLE", modules: ["POSTS"], scope: { type: "FILTER", filters: { search: "med" } },
      }),
    );
  });

  it("targets an Organization with or without its descendants", async () => {
    renderScreen();
    await screen.findByText("INF Site");
    await chooseModule(/POSTS · POSTS/);
    fireEvent.click(screen.getByRole("radio", { name: "An Organization" }));
    expect(screen.getByRole("button", { name: "Preview enable" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(screen.getAllByRole("option", { name: /Informatics/ }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("combobox", { name: "Target Organization" }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include descendant Organizations" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview enable" }));
    await waitFor(() =>
      expect(previewModuleOperation).toHaveBeenCalledWith({
        action: "ENABLE", modules: ["POSTS"], scope: { type: "ORGANIZATION", organization: 6, include_descendants: true },
      }),
    );
  });

  it("shows a failed Site read with a retry", async () => {
    listSiteModuleActivation.mockResolvedValueOnce({ ok: false, error: { status: 500, code: "api_error", message: "Down.", details: null, requestId: "r" } });
    renderScreen();
    expect(await screen.findByText("Down.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("INF Site")).toBeTruthy();
  });
});
