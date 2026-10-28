import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaginatedResponse, Site, SiteDomain } from "@uog/types";
import { defaultSiteConfiguration } from "@uog/api-client";

import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const getSiteTemplate = vi.fn();
const listSiteDomains = vi.fn();
const listAllSiteDomains = vi.fn();
const listSiteModuleAssignments = vi.fn();
const listPlatformModules = vi.fn();
const activateSite = vi.fn();
const suspendSite = vi.fn();
const archiveSite = vi.fn();
const activateSiteDomain = vi.fn();
const deactivateSiteDomain = vi.fn();
const makeSiteDomainPrimary = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  getSiteTemplate: (...args: unknown[]) => getSiteTemplate(...args),
  listSiteDomains: (...args: unknown[]) => listSiteDomains(...args),
  listAllSiteDomains: (...args: unknown[]) => listAllSiteDomains(...args),
  listSiteModuleAssignments: (...args: unknown[]) => listSiteModuleAssignments(...args),
  listPlatformModules: (...args: unknown[]) => listPlatformModules(...args),
  activateSite: (...args: unknown[]) => activateSite(...args),
  suspendSite: (...args: unknown[]) => suspendSite(...args),
  archiveSite: (...args: unknown[]) => archiveSite(...args),
  activateSiteDomain: (...args: unknown[]) => activateSiteDomain(...args),
  deactivateSiteDomain: (...args: unknown[]) => deactivateSiteDomain(...args),
  makeSiteDomainPrimary: (...args: unknown[]) => makeSiteDomainPrimary(...args),
}));

vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
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

import { SiteDetail } from "./site-detail";

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
    template: null,
    configuration: defaultSiteConfiguration("en-us"),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function domain(partial: Partial<SiteDomain> = {}): SiteDomain {
  return {
    id: 1,
    site: 1,
    hostname: "www.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

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

function page<T>(results: T[]): PaginatedResponse<T> {
  return { count: results.length, next: null, previous: null, results };
}

function renderDetail(props: { site?: Site | null }) {
  return render(
    <ToastProvider>
      <SiteDetail site={props.site ?? null} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationTree.mockResolvedValue(treeResults());
  // The hero's primary-domain read stays a filtered single-page read; the
  // panel's lifecycle read composes every page into a plain array.
  listSiteDomains.mockResolvedValue({ ok: true, data: page([]) });
  listAllSiteDomains.mockResolvedValue({ ok: true, data: [] });
  listSiteModuleAssignments.mockResolvedValue({ ok: true, data: page([]) });
  listPlatformModules.mockResolvedValue({ ok: true, data: page([]) });
  getSiteTemplate.mockResolvedValue({
    ok: false,
    error: { status: 404, code: "not_found", message: "No template.", details: null, requestId: null },
  });
});

describe("SiteDetail — owner organization", () => {
  it("shows a root-owned site with the owner's own identity and designation", async () => {
    renderDetail({ site: site() });

    await screen.findByText("Owner organization");
    expect(screen.getByText("UOG")).toBeTruthy();
    expect(screen.getByText("University")).toBeTruthy();
    expect(screen.getByText("Root site")).toBeTruthy();
    expect(screen.getByText("Main university site")).toBeTruthy();
    // The owner panel is separate from the site's own information panel.
    expect(screen.getByText("Site information")).toBeTruthy();
  });

  it("shows a child site with the owner's real type and its root, without assuming a department", async () => {
    renderDetail({
      site: site({
        organization_unit: 2,
        is_main: false,
        code: "COI_PORTAL",
        name: "College of Informatics",
      }),
    });

    await screen.findByText("INFORMATICS");
    expect(screen.getByText("College")).toBeTruthy();
    expect(
      screen.getByText("Child site · under University of Gondar"),
    ).toBeTruthy();
    expect(screen.getByText("Standard site")).toBeTruthy();
    expect(screen.queryByText(/Department/)).toBeNull();
  });

  it("falls back to the raw unit reference when the directory read fails", async () => {
    getOrganizationTree.mockResolvedValue({
      ok: false,
      error: { status: 0, code: "network_error", message: "offline", details: null, requestId: null },
    });

    renderDetail({ site: site({ organization_unit: 2, is_main: false }) });

    expect(await screen.findByText("Unit #2")).toBeTruthy();
    expect(screen.getByText("Relation unknown")).toBeTruthy();
    expect(
      screen.getByText(/organization directory could not be loaded/i),
    ).toBeTruthy();
  });
});

describe("SiteDetail — domains", () => {
  it("lists hostnames with their primary and status flags", async () => {
    listAllSiteDomains.mockResolvedValue({
      ok: true,
      data: [
        domain(),
        domain({
          id: 2,
          hostname: "uog.edu.et",
          is_primary: false,
          redirect_to_primary: true,
        }),
      ],
    });

    renderDetail({ site: site() });

    // The primary hostname now appears in the hero profile and the panel.
    expect((await screen.findAllByText("www.uog.edu.et")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("uog.edu.et")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText("Alias")).toBeTruthy();
    expect(
      screen.getByText("Redirects to the primary domain"),
    ).toBeTruthy();
  });

  it("states when no hostnames are registered", async () => {
    renderDetail({ site: site() });

    expect(
      await screen.findByText("No hostnames are registered for this site yet."),
    ).toBeTruthy();
  });

  it("reports a failed domain read instead of implying there are no domains", async () => {
    listAllSiteDomains.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "Not allowed.",
        details: null,
        requestId: "req-403",
      },
    });

    renderDetail({ site: site() });

    expect(
      await screen.findByText(/domain list could not be loaded/i),
    ).toBeTruthy();
    expect(screen.getByText(/does not mean the site has no domains/i)).toBeTruthy();
    expect(screen.queryByText("No hostnames are registered for this site yet.")).toBeNull();
  });
});

describe("SiteDetail — modules", () => {
  it("says no modules are enabled and does not present planned capabilities as features", async () => {
    renderDetail({ site: site() });

    expect(await screen.findByText(/No modules are enabled for this site/i)).toBeTruthy();
    expect(screen.getByText(/planned capabilities only/i)).toBeTruthy();
  });

  it("renders enabled and disabled assignments once a capability ships", async () => {
    listSiteModuleAssignments.mockResolvedValue({
      ok: true,
      data: page([
        {
          id: 1,
          site: 1,
          module: 7,
          is_enabled: true,
          configuration: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          site: 1,
          module: 8,
          is_enabled: false,
          configuration: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]),
    });
    listPlatformModules.mockResolvedValue({
      ok: true,
      data: page([
        {
          id: 7,
          code: "NEWS",
          name: "News",
          description: "Announcements.",
          status: "IMPLEMENTED",
          is_enabled: true,
          configuration_schema: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]),
    });

    renderDetail({ site: site() });

    // Scope to the Modules panel: the settings section also renders the word
    // "Disabled" for behavior flags.
    const modulesPanel = screen.getByText("Modules").parentElement
      ?.parentElement as HTMLElement;

    expect(await within(modulesPanel).findByText("NEWS — News")).toBeTruthy();
    expect(within(modulesPanel).getByText("Enabled")).toBeTruthy();
    // Module 8 is not in the registry read: id-only, never a guessed name.
    expect(within(modulesPanel).getByText("Module #8")).toBeTruthy();
    expect(within(modulesPanel).getByText("Disabled")).toBeTruthy();
    expect(within(modulesPanel).getAllByText(/registry status/i)).toHaveLength(1);
    expect(
      within(modulesPanel).getByText(/registry status/i).textContent,
    ).toContain("implemented");
  });

  it("reports a failed module read instead of implying no modules", async () => {
    listSiteModuleAssignments.mockResolvedValue({
      ok: false,
      error: {
        status: 500,
        code: "api_error",
        message: "Boom.",
        details: null,
        requestId: null,
      },
    });

    renderDetail({ site: site() });

    expect(
      await screen.findByText(/module assignments could not be loaded/i),
    ).toBeTruthy();
    // The empty-state message must not appear alongside the failure.
    expect(screen.queryByText(/No modules are enabled for this site/i)).toBeNull();
  });
});

describe("SiteDetail — primary domain", () => {
  it("shows the primary domain prominently on the site profile", async () => {
    listSiteDomains.mockImplementation(
      (_siteId: number, query?: { is_primary?: boolean }) =>
        query?.is_primary
          ? Promise.resolve({
              ok: true,
              data: page([
                domain({ id: 9, hostname: "www.uog.edu.et", is_primary: true }),
              ]),
            })
          : Promise.resolve({ ok: true, data: page([domain()]) }),
    );
    listAllSiteDomains.mockResolvedValue({
      ok: true,
      data: [domain({ id: 9, hostname: "www.uog.edu.et", is_primary: true })],
    });

    renderDetail({ site: site() });

    // The hostname appears in the hero profile and in the Domains panel.
    expect(
      (await screen.findAllByText("www.uog.edu.et")).length,
    ).toBeGreaterThanOrEqual(2);
    // Shown in the hero profile, not only in the Domains panel below.
    expect(screen.getByText("Primary domain")).toBeTruthy();
    expect(
      screen.queryByText("No primary domain registered"),
    ).toBeNull();
  });

  it("says so when the site has no primary domain", async () => {
    listSiteDomains.mockResolvedValue({ ok: true, data: page([]) });

    renderDetail({ site: site() });

    expect(
      await screen.findByText("No primary domain registered"),
    ).toBeTruthy();
  });

  it("reports a failed primary-domain read instead of guessing", async () => {
    listSiteDomains.mockResolvedValue({
      ok: false,
      error: { status: 500, code: "api_error", message: "Boom.", details: null, requestId: null },
    });

    renderDetail({ site: site() });

    expect(
      await screen.findByText(/Primary domain unavailable/i),
    ).toBeTruthy();
  });
});

describe("SiteDetail — unavailable site", () => {
  it("renders the unavailable card for a not-found error payload", async () => {
    render(
      <ToastProvider>
        <SiteDetail
          site={null}
          error={{
            status: 404,
            code: "not_found",
            message: "No Site matches the given query.",
            details: null,
            requestId: null,
          }}
        />
      </ToastProvider>,
    );

    expect(await screen.findByText("Site unavailable")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /back to sites/i })).toBeTruthy(),
    );
  });
});
