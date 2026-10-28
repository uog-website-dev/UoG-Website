import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainRecord, PaginatedResponse } from "@uog/types";

const listAllDomains = vi.fn();
const listAllSites = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listAllDomains: (...args: unknown[]) => listAllDomains(...args),
  listAllSites: (...args: unknown[]) => listAllSites(...args),
}));

vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DomainsList } from "./domains-list";

const STAMP = "2026-01-01T00:00:00Z";

function record(partial: Partial<DomainRecord> = {}): DomainRecord {
  return {
    id: 1,
    site: 1,
    hostname: "www.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    site_code: "UOG_MAIN",
    site_name: "University of Gondar",
    site_status: "ACTIVE",
    organization_unit: 1,
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function page<T>(results: T[], count = results.length): PaginatedResponse<T> {
  return { count, next: null, previous: null, results };
}

function ok(data: unknown) {
  return { ok: true as const, data };
}

function failure(message: string, status = 500) {
  return {
    ok: false as const,
    error: { status, code: "api_error", message, details: null, requestId: "req-1" },
  };
}

const TREE = {
  ok: true as const,
  data: {
    count: 2,
    results: [
      { id: 1, code: "UOG", name: "University of Gondar" },
      { id: 2, code: "CI", name: "College of Informatics" },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  listAllDomains.mockResolvedValue(
    ok(
      page([
        record(),
        record({
          id: 2,
          site: 2,
          hostname: "informatics.uog.edu.et",
          is_primary: true,
          site_code: "COI_PORTAL",
          site_name: "College of Informatics",
          organization_unit: 2,
        }),
        record({
          id: 3,
          site: 4,
          hostname: "press.uog.edu.et",
          is_primary: false,
          status: "INACTIVE",
          site_code: "UOG_PRESS",
          site_name: "University Press",
          site_status: "SUSPENDED",
        }),
      ]),
    ),
  );
  listAllSites.mockResolvedValue(
    ok([
      { id: 1, code: "UOG_MAIN", name: "University of Gondar" },
      { id: 2, code: "COI_PORTAL", name: "College of Informatics" },
      { id: 4, code: "UOG_PRESS", name: "University Press" },
    ]),
  );
  getOrganizationTree.mockResolvedValue(TREE);
});

describe("DomainsList", () => {
  it("renders domains with their site, organization, type and statuses", async () => {
    render(<DomainsList />);

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
    expect(screen.getByText("press.uog.edu.et")).toBeTruthy();

    // Site link opens the corresponding Site details screen.
    const siteLink = screen.getByRole("link", {
      name: "University of Gondar (UOG_MAIN)",
    });
    expect(siteLink.getAttribute("href")).toBe("/sites/1");

    // Organization resolved from the hierarchy read (the press row shares
    // the root unit with the main site, so it appears twice).
    expect(screen.getAllByText("UOG — University of Gondar").length).toBe(2);
    expect(screen.getByText("CI — College of Informatics")).toBeTruthy();

    // Primary and alias are visually distinguishable (filled vs outlined).
    expect(screen.getAllByText("Primary").length).toBe(2);
    expect(screen.getByText("Alias")).toBeTruthy();

    // Domain and site statuses.
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.getByText("Suspended")).toBeTruthy();
  });

  it("searches across hostname and site, and resets to page 1", async () => {
    render(<DomainsList />);
    await screen.findByText("www.uog.edu.et");

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "press" },
    });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(listAllDomains).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "press", page: 1 }),
      ),
    );
  });

  it("filters by domain type through the select", async () => {
    render(<DomainsList />);
    await screen.findByText("www.uog.edu.et");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Alias" }));
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(listAllDomains).toHaveBeenLastCalledWith(
        expect.objectContaining({ is_primary: false, page: 1 }),
      ),
    );
  });

  it("filters by site through the select", async () => {
    render(<DomainsList />);
    await screen.findByText("www.uog.edu.et");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Site" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "COI_PORTAL — College of Informatics" }),
    );
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(listAllDomains).toHaveBeenLastCalledWith(
        expect.objectContaining({ site: 2, page: 1 }),
      ),
    );
  });

  it("sorts by the clicked column header", async () => {
    render(<DomainsList />);
    await screen.findByText("www.uog.edu.et");

    fireEvent.click(screen.getByRole("button", { name: "Hostname" }));

    await waitFor(() =>
      expect(listAllDomains).toHaveBeenLastCalledWith(
        expect.objectContaining({ ordering: "-hostname" }),
      ),
    );
  });

  it("paginates when more than one page exists", async () => {
    listAllDomains.mockResolvedValue({
      ok: true,
      data: {
        count: 30,
        next: "?page=2",
        previous: null,
        results: [record()],
      },
    });

    render(<DomainsList />);
    await screen.findByText("www.uog.edu.et");

    const nav = screen.getByRole("navigation", { name: "Domains pagination" });
    expect(nav).toBeTruthy();

    fireEvent.click(within(nav).getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(listAllDomains).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  it("surfaces an API error with a retry instead of an empty table", async () => {
    listAllDomains.mockResolvedValue(failure("Backend exploded."));

    render(<DomainsList />);

    expect(await screen.findByText("Backend exploded.")).toBeTruthy();
    expect(screen.queryByText("No domains are registered")).toBeNull();

    listAllDomains.mockResolvedValue(
      ok(page([record()])),
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
  });

  it("offers a reset when filters match nothing", async () => {
    listAllDomains.mockResolvedValue(ok(page([])));

    render(<DomainsList />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "nothing-matches" },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("No domains match these filters")).toBeTruthy();

    listAllDomains.mockResolvedValue(ok(page([record()])));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
  });

  it("says so honestly when no domains exist at all", async () => {
    listAllDomains.mockResolvedValue(ok(page([])));

    render(<DomainsList />);

    expect(await screen.findByText("No domains are registered")).toBeTruthy();
    expect(
      screen.getByText(/Domains are registered per Site on the site details screen/i),
    ).toBeTruthy();
  });

  it("falls back to unit ids when the hierarchy read fails", async () => {
    getOrganizationTree.mockResolvedValue(failure("Tree unavailable."));

    render(<DomainsList />);

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
    expect((await screen.findAllByText("Unit #1")).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Organization names unavailable/i),
    ).toBeTruthy();
  });

  it("warns when the site filter list could not be loaded", async () => {
    listAllSites.mockResolvedValue(failure("Sites unavailable."));

    render(<DomainsList />);

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
    expect(
      await screen.findByText(/site filter may be incomplete/i),
    ).toBeTruthy();
  });
});
