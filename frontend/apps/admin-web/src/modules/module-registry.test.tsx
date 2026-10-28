import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaginatedResponse, PlatformModule } from "@uog/types";

const listPlatformModules = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listPlatformModules: (...args: unknown[]) => listPlatformModules(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  listPlatformModules.mockResolvedValue(
    ok({ count: 2, next: null, previous: null, results: [moduleFixture(), IMPLEMENTED] }),
  );
});

describe("ModuleRegistry", () => {
  it("renders each capability with honest status and availability chips", async () => {
    render(<ModuleRegistry />);

    // "CMS" also appears in the availability detail list, so scope to the
    // table rows below rather than a single text match.
    await screen.findAllByText("CMS");
    expect(screen.getAllByText("EVENTS").length).toBeGreaterThan(0);

    // Planned: unavailable, spelled out. Implemented+on: available.
    const rows = screen.getAllByRole("row");
    const plannedRow = rows.find((row) => row.textContent?.includes("CMS"));
    const implementedRow = rows.find((row) =>
      row.textContent?.includes("EVENTS"),
    );

    expect(plannedRow?.textContent).toContain("Planned");
    expect(plannedRow?.textContent).toContain("Unavailable");
    expect(plannedRow?.textContent).toContain("Off");
    expect(implementedRow?.textContent).toContain("Implemented");
    expect(implementedRow?.textContent).toContain("Available");
    expect(implementedRow?.textContent).toContain("On");
    expect(implementedRow?.textContent).toContain("1 property");

    // The per-row availability messages repeat the rule for each module.
    expect(
      screen.getAllByText(/registry row is not a working feature/i).length,
    ).toBeGreaterThan(0);
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
