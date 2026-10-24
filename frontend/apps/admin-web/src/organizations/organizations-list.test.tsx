import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Organization, PaginatedResponse } from "@uog/types";

import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const listOrganizations = vi.fn();
const getOrganization = vi.fn();
const getOrganizationTree = vi.fn();
const deactivateOrganization = vi.fn();
const archiveOrganization = vi.fn();

vi.mock("@/app/organizations/actions", () => ({
  listOrganizations: (...args: unknown[]) => listOrganizations(...args),
  getOrganization: (...args: unknown[]) => getOrganization(...args),
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
  deactivateOrganization: (...args: unknown[]) => deactivateOrganization(...args),
  archiveOrganization: (...args: unknown[]) => archiveOrganization(...args),
}));

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh }),
  usePathname: () => "/organizations",
  useSearchParams: () => new URLSearchParams(),
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

import { OrganizationsList } from "./organizations-list";

function org(partial: Partial<Organization>): Organization {
  return {
    id: 1,
    code: "CI",
    name: "College of Informatics",
    short_name: "",
    organization_type: "COLLEGE",
    parent: 1,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function page(results: Organization[], count = results.length): PaginatedResponse<Organization> {
  return { count, next: null, previous: null, results };
}

function renderList() {
  return render(
    <ToastProvider>
      <OrganizationsList />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationTree.mockResolvedValue({
    ok: true,
    data: { count: 0, results: [] },
  });
});

describe("OrganizationsList — reads", () => {
  it("renders rows from the API with status chips", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([
        org({ id: 1, code: "UOG", name: "University of Gondar", parent: null }),
        org({ id: 3, code: "SOFTWARE_ENG", name: "Software Engineering", status: "INACTIVE" }),
      ]),
    });

    renderList();

    expect(await screen.findByText("UOG")).toBeTruthy();
    expect(screen.getByText("University of Gondar")).toBeTruthy();
    expect(screen.getByText("Software Engineering")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hierarchy" }).getAttribute("href")).toBe(
      "/organizations/hierarchy",
    );
    // 2 rows of results => summary reports the count.
    expect(await screen.findByText("2 organizations found")).toBeTruthy();
  });

  it("shows an empty state and offers a filter reset when filters match nothing", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([], 0),
    });

    renderList();

    // Apply a filter first so the empty branch explains filters are the cause.
    fireEvent.change(await screen.findByLabelText("Search"), {
      target: { value: "zzz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(
        screen.getByText("No organizations match these filters"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "Reset filters" }),
    ).toBeTruthy();
  });

  it("surfaces a denied read with its correlation id", async () => {
    listOrganizations.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        details: null,
        requestId: "req-denied",
      },
    });

    renderList();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission|Sign-in|required/i);
    expect(alert.textContent).toContain("req-denied");
  });

  it("filters by name and exact code through the server query and shareable URL", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([]),
    });

    renderList();
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "informatics" },
    });
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "ci" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(listOrganizations).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: "informatics", code: "CI", page: 1 }),
      );
    });
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("name=informatics"),
      { scroll: false },
    );
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("code=CI"),
      { scroll: false },
    );
  });

  it("does not silently apply an invalid exact code filter", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([]),
    });

    renderList();
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "not a code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByLabelText("Code").getAttribute("aria-invalid")).toBe("true");
    expect(listOrganizations).toHaveBeenCalledTimes(1);
  });

  it("links organization names to their details", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([org({ id: 23, code: "LIB", name: "Library" })]),
    });

    renderList();
    const nameLink = await screen.findByRole("link", { name: "Library" });
    expect(nameLink.getAttribute("href")).toBe("/organizations/23");
  });
});

describe("OrganizationsList — lifecycle actions", () => {
  it("offers Deactivate on an ACTIVE unit and Archive on an INACTIVE one", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([
        org({ id: 2, code: "CI", name: "College of Informatics", status: "ACTIVE" }),
        org({ id: 3, code: "SE", name: "Software Engineering", status: "INACTIVE" }),
      ]),
    });

    renderList();

    expect(await screen.findByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    // Archived is terminal and the root is protected: no action offered.
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
  });

  it("offers no lifecycle action on the institutional root or archived units", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([
        org({ id: 1, code: "UOG", name: "University of Gondar", parent: null, status: "ACTIVE" }),
        org({ id: 4, code: "MED", name: "Medicine", status: "ARCHIVED" }),
      ]),
    });

    renderList();

    expect(await screen.findByText("UOG")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    const rootRow = screen.getByText("UOG").closest("tr");
    expect(rootRow).toBeTruthy();
    expect(within(rootRow as HTMLElement).getAllByText("Root").length).toBeGreaterThan(0);
    // "Archived" also appears as the status chip in the same row; scope the
    // assertion to the archived row so both are covered.
    const archivedRow = screen.getByText("Medicine").closest("tr");
    expect(archivedRow).toBeTruthy();
    expect(
      within(archivedRow as HTMLElement).getAllByText("Archived").length,
    ).toBeGreaterThan(0);
  });

  it("requires explicit confirmation before deactivating, and only then calls the API", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([org({ id: 2, code: "CI", name: "College of Informatics", status: "ACTIVE" })]),
    });
    getOrganization.mockResolvedValue({
      ok: true,
      data: { data: org({ id: 2 }), etag: '"etag-2"', requestId: "r" },
    });
    deactivateOrganization.mockResolvedValue({
      ok: true,
      etag: '"etag-3"',
      data: { data: org({ id: 2, status: "INACTIVE" }), etag: '"etag-3"', requestId: "r" },
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

    // Confirmation is required first — nothing has been written yet.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Active to Inactive/i);
    expect(deactivateOrganization).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(deactivateOrganization).toHaveBeenCalledTimes(1));
    // Preconditions on the fresh strong ETag fetched for this unit.
    expect(deactivateOrganization).toHaveBeenCalledWith(2, '"etag-2"');
    expect(refresh).toHaveBeenCalled();
  });

  it("closes without writing when the confirmation is cancelled", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([org({ id: 2, code: "CI", name: "College of Informatics", status: "ACTIVE" })]),
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(deactivateOrganization).not.toHaveBeenCalled();
  });

  it("shows a denied write (403) inside the dialog instead of pretending success", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([org({ id: 2, code: "CI", name: "College of Informatics", status: "ACTIVE" })]),
    });
    getOrganization.mockResolvedValue({
      ok: true,
      data: { data: org({ id: 2 }), etag: '"etag-2"', requestId: "r" },
    });
    deactivateOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message:
          "Organization writes require development mode and explicit opt-in.",
        details: null,
        requestId: "req-403",
      },
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((alert) => /development mode/i.test(alert.textContent ?? "")),
      ).toBe(true);
    });
    // The dialog stays open (no success close) so the failure is visible.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reports a stale ETag (412) during a lifecycle change", async () => {
    listOrganizations.mockResolvedValue({
      ok: true,
      data: page([org({ id: 2, code: "CI", name: "College of Informatics", status: "ACTIVE" })]),
    });
    getOrganization.mockResolvedValue({
      ok: true,
      data: { data: org({ id: 2 }), etag: '"old"', requestId: "r" },
    });
    deactivateOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: "precondition_failed",
        message: "The organization changed. Retrieve it and reconcile your changes.",
        details: null,
        requestId: "req-412",
      },
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((alert) => /changed/i.test(alert.textContent ?? "")),
      ).toBe(true);
    });
  });
});
