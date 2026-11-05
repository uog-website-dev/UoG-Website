import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaginatedResponse, PlatformModule } from "@uog/types";

const listPlatformModules = vi.fn();
const listModuleActivationSummary = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listPlatformModules: (...args: unknown[]) => listPlatformModules(...args),
}));
vi.mock("@/app/modules/actions", () => ({
  listModuleActivationSummary: (...args: unknown[]) => listModuleActivationSummary(...args),
}));

import { ModuleRegistry } from "./module-registry";

const STAMP = "2026-01-01T00:00:00Z";

function moduleFixture(partial: Partial<PlatformModule> = {}): PlatformModule {
  return {
    id: 1,
    code: "CMS",
    name: "Content management",
    description: "Page authoring and publishing.",
    status: "PLANNED",
    is_enabled: false,
    configuration_schema: {},
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

const IMPLEMENTED = moduleFixture({
  id: 10,
  code: "EVENTS",
  name: "Events",
  description: "Calendar and events.",
  status: "IMPLEMENTED",
  is_enabled: true,
  configuration_schema: {
    schema_version: 1,
    properties: [
      { code: "PAGE_SIZE", label: "Page size", type: "integer", required: true },
    ],
  },
});

function ok(data: PaginatedResponse<PlatformModule>) {
  return { ok: true as const, data };
}

function failure(message: string) {
  return {
    ok: false as const,
    error: {
      status: 500,
      code: "api_error",
      message,
      details: null,
      requestId: "req-1",
    },
  };
}

function summaryRow(code: string, partial: Record<string, unknown> = {}) {
  return {
    id: 1, code, name: code, description: "", status: "IMPLEMENTED",
    implementation_status: "AVAILABLE", is_shipped: true, platform_enabled: true,
    enabled_sites: 0, disabled_sites: 0, eligible_sites: 0, total_sites: 4,
    requires: [], required_by: [], updated_at: STAMP, ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPlatformModules.mockResolvedValue(
    ok({ count: 2, next: null, previous: null, results: [moduleFixture(), IMPLEMENTED] }),
  );
  listModuleActivationSummary.mockResolvedValue({
    ok: true,
    data: [
      summaryRow("CMS", { status: "PLANNED", implementation_status: "PLANNED", platform_enabled: false }),
      summaryRow("EVENTS", { enabled_sites: 3, disabled_sites: 1, eligible_sites: 4, requires: ["PAGES"] }),
    ],
  });
});

describe("ModuleRegistry", () => {
  it("keeps implementation status, platform availability and Site activation separate", async () => {
    render(<ModuleRegistry />);

    await screen.findByText("CMS");
    await waitFor(() => expect(listModuleActivationSummary).toHaveBeenCalled());

    const rows = screen.getAllByRole("row");
    const plannedRow = rows.find((row) => row.textContent?.includes("CMS"));
    const implementedRow = rows.find((row) =>
      row.textContent?.includes("EVENTS"),
    );

    await waitFor(() => expect(implementedRow?.textContent).toContain("PAGES"));
    expect(plannedRow?.textContent).toContain("Planned");
    expect(plannedRow?.textContent).toContain("Off");
    expect(implementedRow?.textContent).toContain("Available");
    expect(implementedRow?.textContent).toContain("On");
    expect(implementedRow?.textContent).toContain("3");
    expect(implementedRow?.textContent).toContain("4");
  });

  it("labels an implemented module that is switched off platform-wide", async () => {
    listPlatformModules.mockResolvedValue(
      ok({ count: 1, next: null, previous: null, results: [{ ...IMPLEMENTED, is_enabled: false }] }),
    );
    listModuleActivationSummary.mockResolvedValue({
      ok: true,
      data: [summaryRow("EVENTS", { implementation_status: "IMPLEMENTED_DISABLED", platform_enabled: false })],
    });
    render(<ModuleRegistry />);
    expect(await screen.findByText("Implemented but disabled")).toBeTruthy();
  });

  it("opens a details view with counts, dependencies and settings", async () => {
    render(<ModuleRegistry />);
    await screen.findByText("EVENTS");
    await waitFor(() => expect(screen.getAllByRole("row").some((row) => row.textContent?.includes("PAGES"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Details for EVENTS" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("3 of 4");
    expect(dialog.textContent).toContain("PAGES");
    expect(dialog.textContent).toContain("Page size (required)");
    expect(dialog.textContent).toContain("Available: implemented and enabled platform-wide");
  });

  it("still lists the registry when the activation summary fails", async () => {
    listModuleActivationSummary.mockResolvedValue(failure("Summary down."));
    render(<ModuleRegistry />);
    expect(await screen.findByText(/Site counts and dependencies could not be loaded/)).toBeTruthy();
    expect(screen.getByText("EVENTS")).toBeTruthy();
  });

  it("applies the search filter against the documented contract", async () => {
    render(<ModuleRegistry />);

    await screen.findAllByText("CMS");
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "cms" },
    });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(listPlatformModules).toHaveBeenLastCalledWith({
        search: "cms",
        page: 1,
      }),
    );
  });

  it("surfaces a failed read with a retry instead of an empty table", async () => {
    listPlatformModules.mockResolvedValue(failure("Boom."));

    render(<ModuleRegistry />);

    expect(await screen.findByText("Boom.")).toBeTruthy();
    expect(screen.queryByText("No modules registered")).toBeNull();

    listPlatformModules.mockResolvedValue(
      ok({ count: 1, next: null, previous: null, results: [moduleFixture()] }),
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Content management")).toBeTruthy();
  });

  it("says the registry is empty when it genuinely is", async () => {
    listPlatformModules.mockResolvedValue(
      ok({ count: 0, next: null, previous: null, results: [] }),
    );

    render(<ModuleRegistry />);

    expect(await screen.findByText("No modules registered")).toBeTruthy();
  });

  it("offers a reset when filters match nothing", async () => {
    listPlatformModules.mockResolvedValue(
      ok({ count: 0, next: null, previous: null, results: [] }),
    );

    render(<ModuleRegistry />);

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "nope" },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("No modules match these filters")).toBeTruthy();

    listPlatformModules.mockResolvedValue(
      ok({ count: 1, next: null, previous: null, results: [moduleFixture()] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(await screen.findByText("Content management")).toBeTruthy();
  });

  it("paginates when the registry exceeds one page", async () => {
    listPlatformModules.mockResolvedValue({
      ok: true,
      data: {
        count: 30,
        next: "?page=2",
        previous: null,
        results: [moduleFixture()],
      },
    });

    render(<ModuleRegistry />);

    const nav = await screen.findByRole("navigation", {
      name: "Module registry pagination",
    });
    expect(nav).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(listPlatformModules).toHaveBeenLastCalledWith({ page: 2 }),
    );
  });
});
