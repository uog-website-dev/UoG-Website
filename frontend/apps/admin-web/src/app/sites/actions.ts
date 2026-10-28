"use server";

/**
 * Site mutations and reads, executed on the server.
 *
 * Same contract as the organization actions: the Keycloak access token lives
 * only in the Auth.js session cookie, is read here server-side and handed to
 * the adapter as an Authorization header — never returned to the browser,
 * never placed in a query string and never logged.
 *
 * Every action returns a clone-safe `ActionResult` (see
 * @/organizations/contract — the module is resource-agnostic despite its
 * name, so both features share one serializer instead of drifting). On
 * failure the error is flattened to an `ApiErrorPayload` because `ApiError`'s
 * getters do not survive the React Server Component boundary; clients rebuild
 * a real `ApiError` for the shared UI.
 *
 * Authorization is not decided here. The adapter resolves `API_MODE`, so a
 * production build only ever talks to the live API, and Django independently
 * enforces authentication, the `platform-admin` realm role, the development
 * write opt-in, `If-Match` preconditions and the database lifecycle rules.
 * Their 403/412/428 answers are surfaced verbatim rather than masked.
 */
import {
  ApiError,
  apiModeFromEnv,
  createSitesAdapter,
} from "@uog/api-client";
import type {
  SiteConfigurationChanges,
  SiteCreateInput,
  SiteUpdateInput,
} from "@uog/api-client";
import type {
  DomainListQuery,
  DomainRecord,
  ETaggedResponse,
  PaginatedResponse,
  PlatformModule,
  Site,
  SiteDomain,
  SiteListQuery,
  SiteModuleAssignment,
  SiteTemplate,
  ModuleStatus,
} from "@uog/types";
import type {
  SiteDomainCreateInput,
  SiteDomainUpdateInput,
} from "@uog/api-client";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

/**
 * Internal Docker URL for server-side calls. Browser-side requests go through
 * nginx at `/api`; these run inside the compose network instead.
 */
function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

// The mock adapter owns an in-memory store; keep it per server process so
// mock mutations stay visible to later reads. Live adapters remain
// request-scoped because they are bound to the current user's token.
let mockSitesAdapter: ReturnType<typeof createSitesAdapter> | undefined;

/** Build a request-scoped live adapter or the shared development mock. */
async function buildAdapter() {
  const mode = apiModeFromEnv();
  if (mode === "mock") {
    mockSitesAdapter ??= createSitesAdapter({ mode });
    return mockSitesAdapter;
  }

  const accessToken = await getAccessToken();
  return createSitesAdapter({
    baseUrl: apiBaseUrl(),
    accessToken: accessToken ?? undefined,
    mode,
  });
}

/** Run an adapter call, converting any failure into a clone-safe payload. */
async function attempt<T>(
  run: (adapter: Awaited<ReturnType<typeof buildAdapter>>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const adapter = await buildAdapter();
    const data = await run(adapter);
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

/** Paged, filtered site list for the list screen. */
export async function listSites(
  query: SiteListQuery = {},
): Promise<ActionResult<PaginatedResponse<Site>>> {
  return attempt((adapter) => adapter.list(query));
}

/** Single site plus the strong ETag required for conditional writes. */
export async function getSite(
  id: number,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return attempt((adapter) => adapter.get(id));
}

/**
 * Hostnames registered for one site. A domain row is a routing record from
 * the platform's own database — it proves neither DNS nor TLS exists, and
 * the screens never imply otherwise. An unknown site id answers 404.
 */
export async function listSiteDomains(
  siteId: number,
  query: { status?: "ACTIVE" | "INACTIVE"; is_primary?: boolean } = {},
): Promise<ActionResult<PaginatedResponse<SiteDomain>>> {
  return attempt((adapter) => adapter.listDomains(siteId, query));
}

/**
 * One domain including the strong ETag required for conditional mutations.
 * An unknown id — or one belonging to another Site — answers 404.
 */
export async function getSiteDomain(
  siteId: number,
  id: number,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return attempt((adapter) => adapter.getDomain(siteId, id));
}

/**
 * Register a hostname for a Site. The backend normalizes the value,
 * enforces global uniqueness (a duplicate is 409 under `hostname`) and
 * refuses an ACTIVE domain on an ARCHIVED Site. A new row is never the
 * primary — use `makeSiteDomainPrimary` for that designation.
 */
export async function createSiteDomain(
  siteId: number,
  input: SiteDomainCreateInput,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return attempt((adapter) => adapter.createDomain(siteId, input));
}

/**
 * Change a domain's status or alias-redirect flag (conditional PATCH).
 * Hostname, Site and the primary designation are not editable here.
 */
export async function updateSiteDomain(
  siteId: number,
  id: number,
  input: SiteDomainUpdateInput,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return attempt(async (adapter) => {
    const current = await adapter.getDomain(siteId, id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the domain was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return adapter.updateDomain(siteId, id, current.etag, input);
  });
}

/** Conditional status changes, each against a freshly fetched ETag. */
async function domainStatus(
  siteId: number,
  id: number,
  action: "activate" | "deactivate",
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return attempt(async (adapter) => {
    const current = await adapter.getDomain(siteId, id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the domain was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return action === "activate"
      ? adapter.activateDomain(siteId, id, current.etag)
      : adapter.deactivateDomain(siteId, id, current.etag);
  });
}

export async function activateSiteDomain(
  siteId: number,
  id: number,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return domainStatus(siteId, id, "activate");
}

export async function deactivateSiteDomain(
  siteId: number,
  id: number,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return domainStatus(siteId, id, "deactivate");
}

/**
 * Designate a domain as the Site's primary. The backend clears the previous
 * primary inside one domain lock, so the Site keeps exactly one; callers
 * must confirm with the operator first because this changes routing.
 */
export async function makeSiteDomainPrimary(
  siteId: number,
  id: number,
): Promise<ActionResult<ETaggedResponse<SiteDomain>>> {
  return attempt(async (adapter) => {
    const current = await adapter.getDomain(siteId, id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the domain was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return adapter.makeDomainPrimary(siteId, id, current.etag);
  });
}

/**
 * Central Domain Management listing: every domain across all Sites, joined
 * with its Site's code, name, status and owning unit.
 *
 * The platform API exposes domains per Site only, so the typed client
 * composes this view from the approved endpoints (`GET /sites/` plus
 * `GET /sites/{id}/domains/`) and applies the documented filters, ordering
 * and pagination over the composed rows. No backend change is required,
 * and in mock mode the same interface serves the in-repo fixtures.
 */
export async function listAllDomains(
  query: DomainListQuery = {},
): Promise<ActionResult<PaginatedResponse<DomainRecord>>> {
  return attempt((adapter) => adapter.listDomainsAll(query));
}

/**
 * Every site, for the Domain Management filter select. Bounded by the
 * same 50-page cap the composed domain read uses.
 */
export async function listAllSites(): Promise<ActionResult<Site[]>> {
  return attempt(async (adapter) => {
    const sites: Site[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const result = await adapter.list({ page });
      sites.push(...result.results);
      if (!result.next) break;
    }
    return sites;
  });
}

/** One site's module enablement rows (empty until a capability ships). */
export async function listSiteModuleAssignments(
  siteId: number,
): Promise<ActionResult<PaginatedResponse<SiteModuleAssignment>>> {
  return attempt((adapter) => adapter.listModuleAssignments(siteId));
}

/**
 * Enable one registry module for a site.
 *
 * Creates the assignment when the site has none for that module (applying
 * the initial settings), or re-enables an existing disabled row — which
 * keeps the settings stored on it, exactly as the backend's `enable` action
 * does (its body must be `{}`). `initialConfiguration` therefore only applies
 * to the create path.
 *
 * The strong ETag for a conditional re-enable is fetched immediately before
 * the call, so a stale row can never silently win; the server's usability
 * rule (implemented, globally enabled, shipped) decides whether the write is
 * allowed, and its 400/403 answer is surfaced verbatim.
 */
export async function enableSiteModule(
  siteId: number,
  moduleId: number,
  initialConfiguration?: Record<string, unknown>,
): Promise<ActionResult<ETaggedResponse<SiteModuleAssignment>>> {
  return attempt(async (adapter) => {
    const current = await adapter.listModuleAssignments(siteId, {
      module: moduleId,
    });
    const existing = current.results[0];
    if (!existing) {
      return adapter.createModuleAssignment(siteId, {
        module: moduleId,
        ...(initialConfiguration !== undefined
          ? { configuration: initialConfiguration }
          : {}),
      });
    }
    const detail = await adapter.getModuleAssignment(siteId, existing.id);
    if (!detail.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the module was not changed.",
        428,
        { code: "precondition_required", requestId: detail.requestId },
      );
    }
    return adapter.enableModuleAssignment(siteId, existing.id, detail.etag);
  });
}

/**
 * Turn a module off for a site. The row and its configuration are kept, so
 * re-enabling later restores the same settings — disabling never deletes
 * data. Conditional on the assignment's current strong ETag.
 */
export async function disableSiteModule(
  siteId: number,
  assignmentId: number,
): Promise<ActionResult<ETaggedResponse<SiteModuleAssignment>>> {
  return attempt(async (adapter) => {
    const current = await adapter.getModuleAssignment(siteId, assignmentId);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the module was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return adapter.disableModuleAssignment(siteId, assignmentId, current.etag);
  });
}

/**
 * Replace this site's settings for one module (conditional PATCH). The
 * document is validated by the backend against the module's approved
 * `configuration_schema`; enablement is never changed here.
 */
export async function updateSiteModuleSettings(
  siteId: number,
  assignmentId: number,
  configuration: Record<string, unknown>,
): Promise<ActionResult<ETaggedResponse<SiteModuleAssignment>>> {
  return attempt(async (adapter) => {
    const current = await adapter.getModuleAssignment(siteId, assignmentId);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the module was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return adapter.updateModuleAssignment(
      siteId,
      assignmentId,
      current.etag,
      configuration,
    );
  });
}

/**
 * The platform module registry, used to resolve assignment ids to codes and
 * names. Registry rows are capability *announcements*: a PLANNED row is not
 * a working feature and is shown as such.
 */
export async function listPlatformModules(
  query: { search?: string; status?: ModuleStatus; page?: number } = {},
): Promise<ActionResult<PaginatedResponse<PlatformModule>>> {
  return attempt((adapter) => adapter.listModules(query));
}

/** Templates for the create/edit selector (includes default configuration). */
export async function listSiteTemplates(): Promise<
  ActionResult<PaginatedResponse<SiteTemplate>>
> {
  return attempt((adapter) => adapter.listTemplates());
}

/** One template — the baseline the console compares overrides against. */
export async function getSiteTemplate(
  id: number,
): Promise<ActionResult<ETaggedResponse<SiteTemplate>>> {
  return attempt((adapter) => adapter.getTemplate(id));
}

/**
 * Create a site. The backend always starts it in DRAFT, normalizes the code
 * to upper case, copies the selected template's defaults once and answers
 * 409 for duplicate codes.
 */
export async function createSite(
  input: SiteCreateInput,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return attempt((adapter) => adapter.create(input));
}

/**
 * Conditional partial update. `etag` must be the strong ETag from the detail
 * read the form was populated from: stale is 412, missing is 428, so a
 * concurrent edit can never be silently overwritten. `code`, `status` and
 * `configuration` are not accepted by this endpoint.
 */
export async function updateSite(
  id: number,
  etag: string,
  input: SiteUpdateInput,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return attempt((adapter) => adapter.update(id, etag, input));
}

/** Merge an allowlisted configuration change (conditional on `etag`). */
export async function updateSiteConfiguration(
  id: number,
  etag: string,
  changes: SiteConfigurationChanges,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return attempt((adapter) => adapter.updateConfiguration(id, etag, changes));
}

/**
 * Lifecycle actions. Each runs against the current strong ETag, fetched
 * immediately before the call so a stale row can never silently win — a 412
 * is surfaced as a concurrency message instead.
 */
async function lifecycle(
  id: number,
  action: "activate" | "suspend" | "archive",
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return attempt(async (adapter) => {
    const current = await adapter.get(id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the site was not changed.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    if (action === "activate") return adapter.activate(id, current.etag);
    if (action === "suspend") return adapter.suspend(id, current.etag);
    return adapter.archive(id, current.etag);
  });
}

export async function activateSite(
  id: number,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return lifecycle(id, "activate");
}

export async function suspendSite(
  id: number,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return lifecycle(id, "suspend");
}

export async function archiveSite(
  id: number,
): Promise<ActionResult<ETaggedResponse<Site>>> {
  return lifecycle(id, "archive");
}
