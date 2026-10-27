import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaginatedResponse, Site } from "@uog/types";

import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const listSites = vi.fn();
const listSiteDomains = vi.fn();
const activateSite = vi.fn();
const suspendSite = vi.fn();
const archiveSite = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listSites: (...args: unknown[]) => listSites(...args),
  listSiteDomains: (...args: unknown[]) => listSiteDomains(...args),
  activateSite: (...args: unknown[]) => activateSite(...args),
  suspendSite: (...args: unknown[]) => suspendSite(...args),
  archiveSite: (...args: unknown[]) => archiveSite(...args),
}));

vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh }),
  usePathname: () => "/sites",
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

import { SitesList } from "./sites-list";

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "UoG",
    organization_unit: 1,
    default_language: "en-us",
    status: "ACTIVE",
    is_main: true,
    template: 1,
    configuration: {
      schema_version: 1,
      identity: { display_name: null, logo_ref: null, favicon_ref: null },
      language: { enabled: ["en-us"] },
      presentation: { theme: "institutional" },
      navigation: { items: [] },
      behavior: { show_search: false, show_language_switcher: false },
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function page(results: Site[], count = results.length): PaginatedResponse<Site> {
  return { count, next: null, previous: null, results };
}

function renderList() {
  return render(
    <ToastProvider>
      <SitesList />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationTree.mockResolvedValue({
    ok: true,
    data: { count: 0, results: [] },
  });
  listSiteDomains.mockResolvedValue({
    ok: true,
    data: { count: 0, next: null, previous: null, results: [] },
  });
});

/** A small institutional tree: root unit 1 with a college child (unit 2). */
function treeResults() {
  return {
    ok: true,
    data: {
      count: 2,
      results: [
        {
          id: 1,
          code: "UOG",
          name: "University of Gondar",
          short_name: "",
          organization_type: "UNIVERSITY",
          parent: null,
          description: "",
          status: "ACTIVE",
          metadata: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          code: "INFORMATICS",
          name: "College of Informatics",
          short_name: "",
          organization_type: "COLLEGE",
          parent: 1,
          description: "",
          status: "ACTIVE",
          metadata: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
  };
}

describe("SitesList — reads", () => {
  it("renders rows from the API with status chips", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([
        site(),
        site({
          id: 3,
          code: "RESEARCH_LAB",
          name: "Research Portal",
          status: "DRAFT",
          is_main: false,
          organization_unit: 3,
        }),
      ]),
    });

    renderList();

    expect(await screen.findByText("UOG_MAIN")).toBeTruthy();
    expect(screen.getByText("Research Portal")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(await screen.findByText("2 sites found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New site" }).getAttribute("href")).toBe(
      "/sites/new",
    );
  });

  it("shows an empty state when filters match nothing", async () => {
    listSites.mockResolvedValue({ ok: true, data: page([], 0) });

    renderList();

    fireEvent.change(await screen.findByLabelText("Search"), {
      target: { value: "zzz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByText("No sites match these filters"),
    ).toBeTruthy();
    expect(listSites).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "zzz" }),
    );
  });

  it("surfaces a backend failure through the shared error state", async () => {
    listSites.mockResolvedValue({
      ok: false,
      error: {
        status: 500,
        code: "api_error",
        message: "The site service exploded.",
        details: null,
        requestId: "req-500",
      },
    });

    renderList();

    expect(await screen.findByText("The site service exploded.")).toBeTruthy();
    expect(screen.getByText(/req-500/)).toBeTruthy();
  });
});

describe("SitesList — owner and topology", () => {
  it("shows the owner organization as a distinct record with its own type", async () => {
    getOrganizationTree.mockResolvedValue(treeResults());
    listSites.mockResolvedValue({
      ok: true,
      data: page([
        site({ id: 1, organization_unit: 1, is_main: true }),
        site({
          id: 2,
          code: "COI_PORTAL",
          name: "College of Informatics",
          organization_unit: 2,
          is_main: false,
        }),
      ]),
    });

    renderList();

    await screen.findByText("UOG_MAIN");
    // Root site: owner is the university root, shown with its own identity.
    expect(screen.getAllByText("University of Gondar").length).toBeGreaterThan(0);
    expect(screen.getByText(/UOG · University/)).toBeTruthy();
    expect(screen.getByText("Root site")).toBeTruthy();
    // Child site: the owner's real type is shown — not an assumption.
    expect(screen.getByText(/INFORMATICS · College/)).toBeTruthy();
    expect(screen.getByText("Child site")).toBeTruthy();
    expect(screen.queryByText("Department")).toBeNull();
  });

  it("represents several sites owned by the same organization", async () => {
    getOrganizationTree.mockResolvedValue(treeResults());
    listSites.mockResolvedValue({
      ok: true,
      data: page([
        site({ id: 1, organization_unit: 1, is_main: true }),
        site({ id: 4, code: "UOG_PRESS", organization_unit: 1, is_main: false }),
      ]),
    });

    renderList();

    await screen.findByText("UOG_MAIN");
    expect(screen.getByText("UOG_PRESS")).toBeTruthy();
    // Both rows carry the same owner block; neither claims to be the main site.
    expect(screen.getAllByText(/UOG · University/)).toHaveLength(2);
    expect(screen.getAllByText("Root site")).toHaveLength(2);
  });

  it("falls back to the raw unit id when the hierarchy read failed", async () => {
    getOrganizationTree.mockResolvedValue({
      ok: false,
      error: { status: 0, code: "network_error", message: "offline", details: null, requestId: null },
    });
    listSites.mockResolvedValue({
      ok: true,
      data: page([site({ organization_unit: 2, is_main: false })]),
    });

    renderList();

    await screen.findByText("UOG_MAIN");
    expect(screen.getByText("Unit #2")).toBeTruthy();
    expect(screen.getByText("Relation unknown")).toBeTruthy();
    expect(screen.getByText("Type unknown")).toBeTruthy();
  });
});

describe("SitesList — primary domain", () => {
  it("shows the primary hostname for a row's site", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([site()]),
    });
    listSiteDomains.mockResolvedValue({
      ok: true,
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 1,
            site: 1,
            hostname: "www.uog.edu.et",
            is_primary: true,
            redirect_to_primary: false,
            status: "ACTIVE",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    });

    renderList();

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
    expect(listSiteDomains).toHaveBeenCalledWith(1);
  });

  it("says there is no primary domain instead of leaving the cell empty", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([site()]),
    });

    renderList();

    expect(await screen.findByText("No primary domain")).toBeTruthy();
  });

  it("marks an unreadable domain cell as unavailable, not as empty", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([site()]),
    });
    listSiteDomains.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "Not allowed.",
        details: null,
        requestId: null,
      },
    });

    renderList();

    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("No primary domain")).toBeNull();
  });
});

describe("SitesList — lifecycle", () => {
  it("offers the transitions the backend matrix allows for each status", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([
        site({ id: 1, status: "DRAFT", is_main: false }),
        site({ id: 2, code: "COI_PORTAL", status: "ACTIVE" }),
        site({ id: 4, code: "OLD_SITE", status: "ARCHIVED" }),
      ]),
    });

    renderList();

    await screen.findByText("UOG_MAIN");
    const draftRow = screen.getByText("UOG_MAIN").closest("tr");
    const archivedRow = screen.getByText("OLD_SITE").closest("tr");

    // DRAFT: activate + archive. ACTIVE: suspend + archive (rows are keyed by
    // the buttons rendered inside them).
    for (const label of ["Activate", "Archive"]) {
      expect(
        within(draftRow as HTMLElement).queryByRole("button", { name: label }),
      ).toBeTruthy();
    }
    expect(
      within(archivedRow as HTMLElement).queryByRole("button", { name: "Activate" }),
    ).toBeNull();
    expect(
      within(archivedRow as HTMLElement).queryByRole("button", { name: "Archive" }),
    ).toBeNull();
  });

  it("confirms before archiving and refreshes on success", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([site({ is_main: false })]),
    });
    archiveSite.mockResolvedValue({
      ok: true,
      data: { data: site({ status: "ARCHIVED" }), etag: '"e"', requestId: "r" },
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/final/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(archiveSite).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's denial verbatim instead of pretending success", async () => {
    listSites.mockResolvedValue({
      ok: true,
      data: page([site({ id: 3, status: "DRAFT", organization_unit: 3 })]),
    });
    archiveSite.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message:
          "Administration writes require development mode and explicit opt-in.",
        details: null,
        requestId: "req-403",
      },
    });

    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(
      await within(
        await screen.findByRole("dialog"),
      ).findByText(/development mode and explicit opt-in/i),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
