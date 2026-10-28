/**
 * Swappable Sites data adapters, built against the real Django Sites API
 * (backend/apps/sites, contract docs/api/sites.md).
 *
 * Two implementations satisfy the same `SitesAdapter` interface:
 *
 *   - `createLiveSitesAdapter` talks to /api/v1/sites/ through the typed
 *     HTTP client: structured errors, request ids, strong-ETag `If-Match`
 *     preconditions on every conditional write (PATCH, lifecycle actions and
 *     configuration merges), plus the template reads the console needs to
 *     show inherited values.
 *   - `createMockSitesAdapter` serves the in-repo fixtures for local UI work
 *     with no backend running, reproducing the API's observable behaviour:
 *     pagination, filters, the lifecycle matrix, the owner/topology rules,
 *     409 on stale ETags and 404 for unknown ids.
 *
 * The adapter is chosen *explicitly* by environment (see ./mode.ts). There is
 * no implicit fallback: a production build refuses mock mode outright, so a
 * deployed integration can never serve a fabricated response.
 */
import type {
  DomainListQuery,
  DomainRecord,
  ETaggedResponse,
  PaginatedResponse,
  PlatformModule,
  Site,
  SiteConfiguration,
  SiteDomain,
  SiteDomainStatus,
  SiteListQuery,
  SiteModuleAssignment,
  SiteTemplate,
  ModuleStatus,
} from "@uog/types";

import { ApiError, createApiClient } from "../client";
import { normalizeHostname } from "../hostname";
import { buildQueryString, withQuery } from "../query";
import { organizationFixtures } from "../fixtures/organizations";
import {
  moduleFixtures,
  siteDomainFixtures,
  siteFixtures,
  siteModuleFixtures,
  siteTemplateFixtures,
} from "../fixtures/sites";
import {
  SiteConfigurationError,
  defaultSiteConfiguration,
  mergeSiteConfiguration,
} from "../sites-configuration";
import type { SiteConfigurationChanges } from "../sites-configuration";

/** Page size the backend enforces (20 per page, not client-selectable). */
export const SITES_PAGE_SIZE = 20;

/** Page size of the composed Domain Management listing. */
export const DOMAINS_PAGE_SIZE = 20;

/** Writable fields accepted by `POST /sites/` (status always starts DRAFT). */
export interface SiteCreateInput {
  code: string;
  name: string;
  organization_unit: number;
  short_name?: string;
  default_language?: string;
  is_main?: boolean;
  template?: number | null;
  /** Optional allowlisted configuration merge applied at provisioning. */
  configuration?: SiteConfigurationChanges;
}

/**
 * Writable fields accepted by `PATCH /sites/{id}/`.
 *
 * `code`, `status` and `configuration` are not writable here by contract:
 * codes are immutable, status changes go through the lifecycle actions and
 * configuration through `PATCH /sites/{id}/configuration/`.
 */
export interface SiteUpdateInput {
  name?: string;
  short_name?: string;
  organization_unit?: number;
  default_language?: string;
  is_main?: boolean;
  template?: number | null;
}

/** Validated hostname/status filters for GET /sites/{id}/domains/. */
export interface SiteDomainListQuery {
  status?: SiteDomainStatus;
  is_primary?: boolean;
  page?: number;
}

/**
 * Writable fields accepted by `POST /sites/{site_pk}/domains/`. The
 * hostname is normalized by the backend and must be globally unique;
 * `is_primary` is not a body field (use `make-primary` after creating).
 */
export interface SiteDomainCreateInput {
  hostname: string;
  /** Defaults to INACTIVE; an ACTIVE domain on an ARCHIVED site is a 400. */
  status?: SiteDomainStatus;
  /** Aliases may redirect to the primary; a primary never redirects. */
  redirect_to_primary?: boolean;
}

/**
 * Writable fields accepted by `PATCH /sites/{site_pk}/domains/{id}/`.
 * `hostname`, `site` and the primary designation are not editable here —
 * hostnames are immutable, a domain cannot change Site, and the primary
 * moves only through `POST .../set-primary/`.
 */
export interface SiteDomainUpdateInput {
  status?: SiteDomainStatus;
  redirect_to_primary?: boolean;
}

/** Validated filters for GET /sites/{id}/modules/. */
export interface SiteModuleListQuery {
  /** Exact registry module id. */
  module?: number;
  is_enabled?: boolean;
  page?: number;
}

/**
 * Body accepted by `POST /sites/{site_pk}/modules/` — the endpoint that
 * enables one module for a Site. The configuration is validated by the
 * backend against that module's approved `configuration_schema`; anything
 * unknown, secret-looking or wrongly typed is a 400.
 */
export interface SiteModuleInput {
  module: number;
  configuration?: Record<string, unknown>;
}

/** Validated filters for the platform module registry (GET /modules/). */
export interface PlatformModuleListQuery {
  search?: string;
  status?: ModuleStatus;
  page?: number;
}

export interface SitesAdapter {
  /** Paged, filtered site list. */
  list(query?: SiteListQuery): Promise<PaginatedResponse<Site>>;
  /** Single site including the strong ETag required for mutations. */
  get(id: number): Promise<ETaggedResponse<Site>>;
  /** Hostnames registered for one site (a routing record, not DNS/TLS). */
  listDomains(
    siteId: number,
    query?: SiteDomainListQuery,
  ): Promise<PaginatedResponse<SiteDomain>>;
  /**
   * Central Domain Management listing: every domain across all Sites, joined
   * with its Site's code/name/status/owner.
   *
   * The platform API exposes domains per Site only, so the live adapter
   * composes this from the approved endpoints (sites page loop + per-site
   * domain loops) and applies the documented query filters/sorting over the
   * composed result. The mock serves the same shape from fixtures.
   * An unknown `query.site` answers 404, like a detail read.
   */
  listDomainsAll(
    query?: DomainListQuery,
  ): Promise<PaginatedResponse<DomainRecord>>;
  /** One domain including the strong ETag required for mutations. */
  getDomain(
    siteId: number,
    id: number,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /** `POST /sites/{site_pk}/domains/` — hostname normalized and unique. */
  createDomain(
    siteId: number,
    input: SiteDomainCreateInput,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /**
   * `PATCH .../domains/{id}/` — change status or the alias redirect flag
   * (conditional on `etag`). Hostname, Site and primary are not writable.
   */
  updateDomain(
    siteId: number,
    id: number,
    etag: string,
    input: SiteDomainUpdateInput,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /** `POST .../domains/{id}/activate/` — conditional status change. */
  activateDomain(
    siteId: number,
    id: number,
    etag: string,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /**
   * `POST .../domains/{id}/deactivate/` — conditional status change. An
   * alias deactivates with no payload (`{}`). Deactivating the *active
   * primary* requires `replacement`, the id of another ACTIVE domain on the
   * same Site, which becomes primary in the same transaction; the backend
   * rejects anything else with a field error under `replacement`.
   */
  deactivateDomain(
    siteId: number,
    id: number,
    etag: string,
    replacement?: number,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /**
   * `POST .../domains/{id}/set-primary/` — atomically leaves exactly one
   * primary domain for the Site (conditional on `etag`).
   */
  makeDomainPrimary(
    siteId: number,
    id: number,
    etag: string,
  ): Promise<ETaggedResponse<SiteDomain>>;
  /** One site's module enablement rows (empty until a capability ships). */
  listModuleAssignments(
    siteId: number,
    query?: SiteModuleListQuery,
  ): Promise<PaginatedResponse<SiteModuleAssignment>>;
  /** One assignment including the strong ETag required for mutations. */
  getModuleAssignment(
    siteId: number,
    id: number,
  ): Promise<ETaggedResponse<SiteModuleAssignment>>;
  /**
   * `POST /sites/{site_pk}/modules/` — enable one usable module. A duplicate
   * site/module pair is 409; a planned, unshipped or globally disabled
   * module is 400.
   */
  createModuleAssignment(
    siteId: number,
    input: SiteModuleInput,
  ): Promise<ETaggedResponse<SiteModuleAssignment>>;
  /**
   * `POST .../modules/{id}/enable/` — turn an existing assignment back on
   * (conditional on `etag`). Its stored configuration is kept as-is.
   */
  enableModuleAssignment(
    siteId: number,
    id: number,
    etag: string,
  ): Promise<ETaggedResponse<SiteModuleAssignment>>;
  /**
   * `POST .../modules/{id}/disable/` — turn the module off for this Site
   * (conditional on `etag`). The row and its configuration are preserved.
   */
  disableModuleAssignment(
    siteId: number,
    id: number,
    etag: string,
  ): Promise<ETaggedResponse<SiteModuleAssignment>>;
  /**
   * `PATCH .../modules/{id}/` — replace this assignment's settings
   * (conditional on `etag`). Enablement is not writable here: `is_enabled`
   * is read-only on the endpoint.
   */
  updateModuleAssignment(
    siteId: number,
    id: number,
    etag: string,
    configuration: Record<string, unknown>,
  ): Promise<ETaggedResponse<SiteModuleAssignment>>;
  /** Platform module registry, used to resolve assignment ids to codes. */
  listModules(
    query?: PlatformModuleListQuery,
  ): Promise<PaginatedResponse<PlatformModule>>;
  /** Templates for the create/edit selector (default configuration included). */
  listTemplates(): Promise<PaginatedResponse<SiteTemplate>>;
  /** One template, used to compare inherited defaults against overrides. */
  getTemplate(id: number): Promise<ETaggedResponse<SiteTemplate>>;
  /** Create a site; the backend always starts it in DRAFT. */
  create(input: SiteCreateInput): Promise<ETaggedResponse<Site>>;
  /** Conditional partial update; `etag` must be the current strong ETag. */
  update(
    id: number,
    etag: string,
    input: SiteUpdateInput,
  ): Promise<ETaggedResponse<Site>>;
  /** Merge an allowlisted configuration change (conditional on `etag`). */
  updateConfiguration(
    id: number,
    etag: string,
    changes: SiteConfigurationChanges,
  ): Promise<ETaggedResponse<Site>>;
  /** DRAFT/SUSPENDED -> ACTIVE. Requires the current strong ETag. */
  activate(id: number, etag: string): Promise<ETaggedResponse<Site>>;
  /** ACTIVE -> SUSPENDED. Requires the current strong ETag. */
  suspend(id: number, etag: string): Promise<ETaggedResponse<Site>>;
  /** DRAFT/ACTIVE/SUSPENDED -> ARCHIVED (terminal). Requires the ETag. */
  archive(id: number, etag: string): Promise<ETaggedResponse<Site>>;
}

const SITES_PATH = "/v1/sites/";
const TEMPLATES_PATH = "/v1/site-templates/";
const MODULES_PATH = "/v1/modules/";

/** Build the validated list query string for GET /sites/. */
export function siteListQueryString(query: SiteListQuery = {}): string {
  return buildQueryString({
    search: query.search,
    code: query.code,
    status: query.status,
    organization_unit: query.organization_unit,
    ordering: query.ordering,
    page: query.page,
  });
}

/**
 * Sortable fields of the composed Domain Management listing. Each maps to a
 * value on `DomainRecord`; `ordering` accepts them comma-separated with a
 * `-` prefix for descending, like the backend's ordering contract.
 */
const DOMAIN_ORDER_FIELDS: Record<
  string,
  (record: DomainRecord) => string | number | boolean
> = {
  hostname: (record) => record.hostname,
  site: (record) => record.site_code,
  organization: (record) => record.organization_unit,
  type: (record) => record.is_primary,
  status: (record) => record.status,
  site_status: (record) => record.site_status,
};

/** Join one domain with the Site fields the listing needs to display. */
function toDomainRecord(domain: SiteDomain, site: Site): DomainRecord {
  return {
    ...domain,
    site_code: site.code,
    site_name: site.name,
    site_status: site.status,
    organization_unit: site.organization_unit,
  };
}

/** Apply a DomainListQuery to composed rows: filter, order, paginate. */
export function queryDomainRecords(
  records: DomainRecord[],
  query: DomainListQuery = {},
): PaginatedResponse<DomainRecord> {
  let results = [...records];

  if (query.site !== undefined) {
    results = results.filter((record) => record.site === query.site);
  }
  if (query.is_primary !== undefined) {
    results = results.filter((record) => record.is_primary === query.is_primary);
  }
  if (query.status) {
    results = results.filter((record) => record.status === query.status);
  }
  if (query.search) {
    const needle = query.search.trim().toLowerCase();
    results = results.filter((record) =>
      `${record.hostname} ${record.site_code} ${record.site_name}`
        .toLowerCase()
        .includes(needle),
    );
  }

  // Successive stable sorts, last field first — same semantics the sites
  // list uses. Unknown ordering fields are ignored rather than guessed.
  const ordering = (query.ordering ?? "hostname").split(",");
  for (const field of [...ordering].reverse()) {
    const descending = field.startsWith("-");
    const name = field.startsWith("-") ? field.slice(1) : field;
    const keyOf = DOMAIN_ORDER_FIELDS[name];
    if (!keyOf) continue;
    results.sort((left, right) => {
      const a = keyOf(left);
      const b = keyOf(right);
      const cmp =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : typeof a === "boolean" && typeof b === "boolean"
            ? Number(a) - Number(b)
            : String(a).localeCompare(String(b));
      return descending ? -cmp : cmp;
    });
  }

  const count = results.length;
  const page = Math.max(1, query.page ?? 1);
  const start = (page - 1) * DOMAINS_PAGE_SIZE;
  const slice = results.slice(start, start + DOMAINS_PAGE_SIZE);
  return {
    count,
    next: start + DOMAINS_PAGE_SIZE < count ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: slice,
  };
}

/** Live adapter: the real Django Sites API via the typed HTTP client. */
export function createLiveSitesAdapter(options: {
  baseUrl: string;
  accessToken?: string;
  fetchFn?: typeof fetch;
}): SitesAdapter {
  const client = createApiClient({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  const toEtagged = <T>(result: {
    data: T;
    etag: string | null;
    requestId: string | null;
  }): ETaggedResponse<T> => ({
    data: result.data,
    etag: result.etag,
    requestId: result.requestId,
  });

  /**
   * Walk a paginated endpoint to exhaustion (bounded at 50 pages / 1000
   * rows, matching the platform's documented scale for composed reads).
   */
  async function collect<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const result = await client.get<PaginatedResponse<T>>(
        withQuery(path, buildQueryString({ page })),
      );
      rows.push(...result.results);
      if (!result.next) break;
    }
    return rows;
  }

  return {
    async list(query) {
      const path = withQuery(SITES_PATH, siteListQueryString(query));
      return client.get<PaginatedResponse<Site>>(path);
    },
    async get(id) {
      return toEtagged(await client.getDetailed<Site>(`${SITES_PATH}${id}/`));
    },
    async listDomains(siteId, query) {
      const path = withQuery(
        `${SITES_PATH}${siteId}/domains/`,
        buildQueryString({
          status: query?.status,
          is_primary:
            query?.is_primary === undefined
              ? undefined
              : String(query.is_primary),
          page: query?.page,
        }),
      );
      return client.get<PaginatedResponse<SiteDomain>>(path);
    },
    async listDomainsAll(query = {}) {
      // Compose from the approved per-site endpoints: collect the sites
      // (one, when filtered — a detail read, so unknown ids answer 404),
      // then each site's domains, then apply the documented filters/sort.
      const sites: Site[] =
        query.site !== undefined
          ? [await client.get<Site>(`${SITES_PATH}${query.site}/`)]
          : await collect<Site>(SITES_PATH);

      const records: DomainRecord[] = [];
      for (const site of sites) {
        const domains = await collect<SiteDomain>(`${SITES_PATH}${site.id}/domains/`);
        for (const domain of domains) {
          records.push(toDomainRecord(domain, site));
        }
      }
      return queryDomainRecords(records, query);
    },
    async getDomain(siteId, id) {
      return toEtagged(
        await client.getDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/${id}/`,
        ),
      );
    },
    async createDomain(siteId, input) {
      return toEtagged(
        await client.postDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/`,
          input,
        ),
      );
    },
    async updateDomain(siteId, id, etag, input) {
      return toEtagged(
        await client.patchDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/${id}/`,
          input,
          { ifMatch: etag },
        ),
      );
    },
    async activateDomain(siteId, id, etag) {
      return toEtagged(
        await client.postDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/${id}/activate/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async deactivateDomain(siteId, id, etag, replacement) {
      return toEtagged(
        await client.postDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/${id}/deactivate/`,
          // An alias deactivates with an empty object; the active primary
          // must name another active domain on the same Site.
          replacement === undefined ? {} : { replacement },
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async makeDomainPrimary(siteId, id, etag) {
      return toEtagged(
        await client.postDetailed<SiteDomain>(
          `${SITES_PATH}${siteId}/domains/${id}/set-primary/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async listModuleAssignments(siteId, query) {
      const path = withQuery(
        `${SITES_PATH}${siteId}/modules/`,
        buildQueryString({
          module: query?.module,
          is_enabled:
            query?.is_enabled === undefined
              ? undefined
              : String(query.is_enabled),
          page: query?.page,
        }),
      );
      return client.get<PaginatedResponse<SiteModuleAssignment>>(path);
    },
    async getModuleAssignment(siteId, id) {
      return toEtagged(
        await client.getDetailed<SiteModuleAssignment>(
          `${SITES_PATH}${siteId}/modules/${id}/`,
        ),
      );
    },
    async createModuleAssignment(siteId, input) {
      return toEtagged(
        await client.postDetailed<SiteModuleAssignment>(
          `${SITES_PATH}${siteId}/modules/`,
          input,
        ),
      );
    },
    async enableModuleAssignment(siteId, id, etag) {
      return toEtagged(
        await client.postDetailed<SiteModuleAssignment>(
          `${SITES_PATH}${siteId}/modules/${id}/enable/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async disableModuleAssignment(siteId, id, etag) {
      return toEtagged(
        await client.postDetailed<SiteModuleAssignment>(
          `${SITES_PATH}${siteId}/modules/${id}/disable/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async updateModuleAssignment(siteId, id, etag, configuration) {
      return toEtagged(
        await client.patchDetailed<SiteModuleAssignment>(
          `${SITES_PATH}${siteId}/modules/${id}/`,
          { configuration },
          { ifMatch: etag },
        ),
      );
    },
    async listModules(query) {
      const path = withQuery(
        MODULES_PATH,
        buildQueryString({
          search: query?.search,
          status: query?.status,
          page: query?.page,
        }),
      );
      return client.get<PaginatedResponse<PlatformModule>>(path);
    },
    async listTemplates() {
      return client.get<PaginatedResponse<SiteTemplate>>(TEMPLATES_PATH);
    },
    async getTemplate(id) {
      return toEtagged(
        await client.getDetailed<SiteTemplate>(`${TEMPLATES_PATH}${id}/`),
      );
    },
    async create(input) {
      return toEtagged(await client.postDetailed<Site>(SITES_PATH, input));
    },
    async update(id, etag, input) {
      return toEtagged(
        await client.patchDetailed<Site>(`${SITES_PATH}${id}/`, input, {
          ifMatch: etag,
        }),
      );
    },
    async updateConfiguration(id, etag, changes) {
      return toEtagged(
        await client.patchDetailed<Site>(
          `${SITES_PATH}${id}/configuration/`,
          changes,
          { ifMatch: etag },
        ),
      );
    },
    async activate(id, etag) {
      return toEtagged(
        await client.postDetailed<Site>(
          `${SITES_PATH}${id}/activate/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async suspend(id, etag) {
      return toEtagged(
        await client.postDetailed<Site>(
          `${SITES_PATH}${id}/suspend/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
    async archive(id, etag) {
      return toEtagged(
        await client.postDetailed<Site>(
          `${SITES_PATH}${id}/archive/`,
          {},
          { headers: { "If-Match": etag } },
        ),
      );
    },
  };
}

/**
 * Lifecycle matrix from sites_validate_lifecycle (migration_sql.py).
 * Same-state saves are allowed; ARCHIVED is terminal.
 */
const TRANSITIONS: Record<Site["status"], readonly Site["status"][]> = {
  DRAFT: ["DRAFT", "ACTIVE", "ARCHIVED"],
  ACTIVE: ["ACTIVE", "SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["SUSPENDED", "ACTIVE", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED"],
};

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;

/**
 * Mock adapter: serves the in-repo fixtures with the same observable
 * behaviour the API produces, so screens exercise identical code paths
 * without a running backend.
 */
export function createMockSitesAdapter(options?: {
  seed?: Site[];
  /** Registry rows to serve instead of the default (all-planned) fixtures. */
  seedModules?: PlatformModule[];
  /** Existing per-site assignments, e.g. for local enable/disable work. */
  seedModuleAssignments?: SiteModuleAssignment[];
  latencyMs?: number;
}): SitesAdapter {
  const latencyMs = options?.latencyMs ?? 150;
  let store: Site[] = (options?.seed ?? siteFixtures).map((site) => ({
    ...site,
    configuration: {
      ...site.configuration,
      identity: { ...site.configuration.identity },
      language: {
        enabled: [...site.configuration.language.enabled],
      },
      presentation: { ...site.configuration.presentation },
      navigation: {
        items: site.configuration.navigation.items.map((item) => ({
          ...item,
        })),
      },
      behavior: { ...site.configuration.behavior },
    },
  }));
  let nextId = store.reduce((max, site) => Math.max(max, site.id), 0) + 1;

  // Registry and assignment stores: the default fixtures keep every seeded
  // capability PLANNED and globally disabled (registering a row is not
  // implementing a feature), so enabling anything out of the box is refused
  // exactly as the live API would refuse it. Tests/local work can seed an
  // IMPLEMENTED, globally enabled module to exercise the success paths.
  let modules: PlatformModule[] = (options?.seedModules ?? moduleFixtures).map(
    (entry) => ({
      ...entry,
      configuration_schema: { ...entry.configuration_schema },
    }),
  );
  let assignments: SiteModuleAssignment[] = (
    options?.seedModuleAssignments ?? siteModuleFixtures
  ).map((row) => ({ ...row, configuration: { ...row.configuration } }));
  let nextAssignmentId =
    assignments.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  // Domain rows are mutable in the mock so add/edit flows can be exercised
  // locally with the same observable rules the API enforces.
  let domains: SiteDomain[] = siteDomainFixtures.map((row) => ({ ...row }));
  let nextDomainId =
    domains.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  const wait = () =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  const etagFor = (site: Site): string =>
    `"mock-${site.id}-${site.updated_at}"`;

  const require = (id: number): Site => {
    const found = store.find((site) => site.id === id);
    if (!found) {
      throw new ApiError("The requested resource was not found.", 404, {
        code: "not_found",
        details: { detail: "No Site matches the given query." },
      });
    }
    return found;
  };

  const checkEtag = (site: Site, etag: string) => {
    if (etag !== etagFor(site)) {
      throw new ApiError(
        "The resource changed. Retrieve it and reconcile your changes.",
        412,
        { code: "precondition_failed" },
      );
    }
  };

  const checkEtagAssignment = (
    row: SiteModuleAssignment,
    etag: string,
  ) => {
    if (etag !== assignmentEtag(row)) {
      throw new ApiError(
        "The resource changed. Retrieve it and reconcile your changes.",
        412,
        { code: "precondition_failed" },
      );
    }
  };

  const respond = (site: Site, requestId: string): ETaggedResponse<Site> => ({
    data: { ...site, configuration: structuredCloneSafe(site.configuration) },
    etag: etagFor(site),
    requestId,
  });

  /** 400 shaped like a DRF field-error body. */
  const invalid = (details: Record<string, string[]>): ApiError => {
    const message = Object.values(details).flat().join(" ");
    return new ApiError(message, 400, {
      code: "validation_error",
      details,
    });
  };

  const conflict = (details: Record<string, string[]>): ApiError =>
    new ApiError("The request conflicts with the current resource state.", 409, {
      code: "conflict",
      details,
    });

  const assignmentEtag = (row: SiteModuleAssignment): string =>
    `"mock-assignment-${row.id}-${row.updated_at}"`;

  const requireAssignment = (
    siteId: number,
    id: number,
  ): SiteModuleAssignment => {
    // The API scopes the queryset to the site, so an unknown assignment id
    // and an assignment belonging to another Site both answer 404.
    const found = assignments.find(
      (row) => row.id === id && row.site === siteId,
    );
    if (!found) {
      throw new ApiError("The requested resource was not found.", 404, {
        code: "not_found",
        details: { detail: "No SiteModule matches the given query." },
      });
    }
    return found;
  };

  const requireModule = (id: number): PlatformModule => {
    const found = modules.find((entry) => entry.id === id);
    if (!found) {
      throw invalid({
        module: ["Invalid pk — no Module matches the given query."],
      });
    }
    return found;
  };

  /**
   * Usable = IMPLEMENTED and globally enabled. The live database also
   * requires a recorded shipped capability, but it enforces that *before* a
   * row can even be marked IMPLEMENTED — so an IMPLEMENTED fixture is by
   * construction shipped, and this predicate matches `module_is_usable`.
   */
  const moduleIsUsable = (module: PlatformModule): boolean =>
    module.status === "IMPLEMENTED" && module.is_enabled;

  const SECRET_KEY =
    /password|secret|token|credential|api_key|private_key|session/i;

  interface ModuleProperty {
    code: string;
    type: "boolean" | "string" | "integer";
    required: boolean;
  }

  /** Approved property list of a module's schema, or null if unapproved. */
  const schemaProperties = (module: PlatformModule): ModuleProperty[] | null => {
    const schema = module.configuration_schema as
      | { properties?: unknown }
      | undefined
      | null;
    if (schema === null || schema === undefined || typeof schema !== "object") {
      return null;
    }
    const properties = schema.properties ?? [];
    if (!Array.isArray(properties)) return null;
    const approved = properties.filter(
      (item): item is ModuleProperty =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ModuleProperty).code === "string" &&
        typeof (item as ModuleProperty).type === "string" &&
        typeof (item as ModuleProperty).required === "boolean",
    );
    return approved.length === properties.length ? approved : null;
  };

  /** Mirror of normalize_site_module_configuration (module_schema.py). */
  const validateModuleConfiguration = (
    module: PlatformModule,
    document: unknown,
  ): void => {
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      throw invalid({
        configuration: ["Site module configuration must be a JSON object."],
      });
    }
    for (const key of Object.keys(document)) {
      if (SECRET_KEY.test(key)) {
        throw invalid({
          configuration: [
            "Module configuration schema cannot describe secrets.",
          ],
        });
      }
    }
    const properties = schemaProperties(module);
    if (properties === null) {
      throw invalid({
        configuration: ["Site module configuration is not approved."],
      });
    }
    const allowed = new Map(properties.map((item) => [item.code, item]));
    const documentKeys = Object.keys(document);
    if (documentKeys.some((key) => !allowed.has(key))) {
      throw invalid({
        configuration: ["Site module configuration is not approved."],
      });
    }
    for (const [code, spec] of allowed) {
      if (!(code in document)) {
        if (spec.required) {
          throw invalid({
            configuration: [
              "Site module configuration is missing a required property.",
            ],
          });
        }
        continue;
      }
      const value = (document as Record<string, unknown>)[code];
      const approved =
        spec.type === "boolean"
          ? typeof value === "boolean"
          : spec.type === "string"
            ? typeof value === "string" &&
              value.trim() !== "" &&
              value === value.trim() &&
              value.length <= 500
            : typeof value === "number" &&
              Number.isInteger(value) &&
              !Number.isNaN(value);
      if (!approved) {
        throw invalid({
          configuration: ["Site module configuration is not approved."],
        });
      }
    }
  };

  const respondAssignment = (
    row: SiteModuleAssignment,
    requestId: string,
  ): ETaggedResponse<SiteModuleAssignment> => ({
    data: { ...row, configuration: { ...row.configuration } },
    etag: assignmentEtag(row),
    requestId,
  });

  const domainEtag = (row: SiteDomain): string =>
    `"mock-domain-${row.id}-${row.updated_at}"`;

  const checkDomainEtag = (row: SiteDomain, etag: string) => {
    if (etag !== domainEtag(row)) {
      throw new ApiError(
        "The resource changed. Retrieve it and reconcile your changes.",
        412,
        { code: "precondition_failed" },
      );
    }
  };

  const requireDomain = (siteId: number, id: number): SiteDomain => {
    // The queryset is scoped to the site, so an unknown id and an id that
    // belongs to another Site both answer 404.
    const found = domains.find((row) => row.id === id && row.site === siteId);
    if (!found) {
      throw new ApiError("The requested resource was not found.", 404, {
        code: "not_found",
        details: { detail: "No SiteDomain matches the given query." },
      });
    }
    return found;
  };

  const respondDomain = (
    row: SiteDomain,
    requestId: string,
  ): ETaggedResponse<SiteDomain> => ({
    data: { ...row },
    etag: domainEtag(row),
    requestId,
  });

  /** Mirror of normalize_hostname + the archived-site status rule. */
  const validatedHostname = (raw: string): string => {
    const parsed = normalizeHostname(raw);
    if (parsed.error !== undefined) {
      throw invalid({ hostname: [parsed.error] });
    }
    return parsed.hostname;
  };

  const validateDomainStatus = (row: { status: SiteDomainStatus; site: number }) => {
    if (row.status === "ACTIVE") {
      const owner = store.find((site) => site.id === row.site);
      if (owner?.status === "ARCHIVED") {
        throw invalid({
          status: ["An archived Site cannot have an active domain."],
        });
      }
    }
  };

  const mockRequestId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `mock-${Math.random().toString(36).slice(2, 10)}`;

  /** Fixed page-size envelope over an already-filtered, ordered list. */
  const pageOf = <T>(results: T[], page = 1): PaginatedResponse<T> => {
    const count = results.length;
    const current = Math.max(1, page ?? 1);
    const start = (current - 1) * SITES_PAGE_SIZE;
    const slice = results.slice(start, start + SITES_PAGE_SIZE);
    return {
      count,
      next: start + SITES_PAGE_SIZE < count ? `?page=${current + 1}` : null,
      previous: current > 1 ? `?page=${current - 1}` : null,
      results: slice,
    };
  };

  /** Owner lookup against the organization fixtures (mock data set). */
  const ownerOf = (id: number) =>
    organizationFixtures.find((org) => org.id === id);

  /** Mirror of the database owner/topology rules, for honest local feedback. */
  const validateOwner = (
    organizationUnit: number,
    isMain: boolean,
    context: "new" | "active",
  ): void => {
    const owner = ownerOf(organizationUnit);
    if (!owner) {
      throw invalid({
        organization_unit: ["The owning OrganizationUnit does not exist."],
      });
    }
    if (isMain && (owner.parent !== null || owner.organization_type !== "UNIVERSITY")) {
      throw invalid({
        organization_unit: ["The main university Site must belong to the UNIVERSITY root."],
      });
    }
    if (context === "active" && owner.status !== "ACTIVE") {
      throw invalid({
        organization_unit: ["An ACTIVE Site requires an ACTIVE OrganizationUnit."],
      });
    }
  };

  const validateNewOwner = (organizationUnit: number, isMain: boolean): void => {
    validateOwner(organizationUnit, isMain, "new");
    const owner = ownerOf(organizationUnit);
    if (owner && owner.status !== "ACTIVE") {
      throw invalid({
        organization_unit: ["New Site ownership requires an ACTIVE OrganizationUnit."],
      });
    }
  };

  /** Apply the lifecycle matrix plus the ACTIVE-owner rule. */
  function transition(
    id: number,
    etag: string,
    next: Site["status"],
  ): ETaggedResponse<Site> {
    const site = require(id);
    checkEtag(site, etag);

    if (!TRANSITIONS[site.status].includes(next)) {
      throw invalid({
        status: ["This Site lifecycle transition is not allowed."],
      });
    }
    if (next === "ACTIVE") validateOwner(site.organization_unit, site.is_main, "active");

    const updated: Site = {
      ...site,
      status: next,
      updated_at: new Date().toISOString(),
    };
    store = store.map((entry) => (entry.id === id ? updated : entry));
    return respond(updated, mockRequestId());
  }

  return {
    async list(query = {}) {
      await wait();
      let results = [...store];

      if (query.search) {
        const needle = query.search.trim().toLowerCase();
        results = results.filter(
          (site) =>
            site.name.toLowerCase().includes(needle) ||
            site.code.toLowerCase().includes(needle),
        );
      }
      if (query.code) {
        const code = query.code.trim().toUpperCase();
        results = results.filter((site) => site.code === code);
      }
      if (query.status) {
        results = results.filter((site) => site.status === query.status);
      }
      if (query.organization_unit !== undefined) {
        results = results.filter(
          (site) => site.organization_unit === query.organization_unit,
        );
      }

      const ordering = (query.ordering ?? "code").split(",");
      for (const field of [...ordering].reverse()) {
        const descending = field.startsWith("-");
        const key = (field.startsWith("-") ? field.slice(1) : field) as keyof Site;
        results.sort((a, b) => {
          const left = a[key];
          const right = b[key];
          const cmp =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right));
          return descending ? -cmp : cmp;
        });
      }

      const count = results.length;
      const page = Math.max(1, query.page ?? 1);
      const start = (page - 1) * SITES_PAGE_SIZE;
      const pageResults = results.slice(start, start + SITES_PAGE_SIZE);
      const hasNext = start + SITES_PAGE_SIZE < count;

      return {
        count,
        next: hasNext ? `?page=${page + 1}` : null,
        previous: page > 1 ? `?page=${page - 1}` : null,
        results: pageResults.map((site) => ({
          ...site,
          configuration: structuredCloneSafe(site.configuration),
        })),
      } satisfies PaginatedResponse<Site>;
    },

    async get(id) {
      await wait();
      return respond(require(id), mockRequestId());
    },

    async listDomains(siteId, query = {}) {
      await wait();
      // The API 404s when the site itself does not exist, before any filter.
      require(siteId);
      let results = domains.filter((domain) => domain.site === siteId);
      if (query.status) {
        results = results.filter((domain) => domain.status === query.status);
      }
      if (query.is_primary !== undefined) {
        results = results.filter(
          (domain) => domain.is_primary === query.is_primary,
        );
      }
      results.sort((left, right) => left.hostname.localeCompare(right.hostname));
      return pageOf(results, query.page);
    },

    async listDomainsAll(query = {}) {
      await wait();
      // Same join the live adapter performs over the per-site endpoints; an
      // unknown site filter 404s exactly like a detail read.
      const sites =
        query.site !== undefined ? [require(query.site)] : store;
      const records: DomainRecord[] = sites.flatMap((site) =>
        domains
          .filter((domain) => domain.site === site.id)
          .map((domain) => toDomainRecord(domain, site)),
      );
      return queryDomainRecords(records, query);
    },

    async getDomain(siteId, id) {
      await wait();
      return respondDomain(requireDomain(siteId, id), mockRequestId());
    },

    async createDomain(siteId, input) {
      await wait();
      const owner = require(siteId);
      const hostname = validatedHostname(input.hostname);
      if (domains.some((row) => row.hostname === hostname)) {
        // translate_domain_errors maps "already exists" onto a 409 with the
        // offending field.
        throw conflict({
          hostname: ["Site domain with this hostname already exists."],
        });
      }
      const status = input.status ?? "INACTIVE";
      validateDomainStatus({ status, site: siteId });
      if (input.redirect_to_primary) {
        // New rows are never primary (is_primary is not a body field), so an
        // alias redirect is fine — but it cannot point at a missing primary.
        // The backend stores the flag regardless; no extra rule here.
      }
      const now = new Date().toISOString();
      const created: SiteDomain = {
        id: nextDomainId++,
        site: owner.id,
        hostname,
        is_primary: false,
        redirect_to_primary: input.redirect_to_primary ?? false,
        status,
        created_at: now,
        updated_at: now,
      };
      domains = [...domains, created];
      return respondDomain(created, mockRequestId());
    },

    async updateDomain(siteId, id, etag, input) {
      await wait();
      const row = requireDomain(siteId, id);
      checkDomainEtag(row, etag);
      // Hostname, Site and the primary designation are not writable here.
      if (input.redirect_to_primary && row.is_primary) {
        throw invalid({
          redirect_to_primary: ["A primary domain cannot redirect to itself."],
        });
      }
      const status = input.status ?? row.status;
      validateDomainStatus({ status, site: row.site });
      const updated: SiteDomain = {
        ...row,
        status,
        redirect_to_primary: input.redirect_to_primary ?? row.redirect_to_primary,
        updated_at: new Date().toISOString(),
      };
      domains = domains.map((entry) => (entry.id === row.id ? updated : entry));
      return respondDomain(updated, mockRequestId());
    },

    async activateDomain(siteId, id, etag) {
      await wait();
      const row = requireDomain(siteId, id);
      checkDomainEtag(row, etag);
      validateDomainStatus({ status: "ACTIVE", site: row.site });
      const updated: SiteDomain = {
        ...row,
        status: "ACTIVE",
        updated_at: new Date().toISOString(),
      };
      domains = domains.map((entry) => (entry.id === row.id ? updated : entry));
      return respondDomain(updated, mockRequestId());
    },

    async deactivateDomain(siteId, id, etag, replacement) {
      await wait();
      const row = requireDomain(siteId, id);
      checkDomainEtag(row, etag);
      // Idempotent no-op, exactly like the backend service: an already
      // inactive domain is returned unchanged, before any primary rule runs
      // — deactivating an inactive primary needs no replacement.
      if (row.status === "INACTIVE") {
        return respondDomain(row, mockRequestId());
      }
      if (row.is_primary) {
        // Deactivating the active primary requires `replacement`, the id of
        // another ACTIVE domain on the same Site. The backend validates this
        // inside one transaction: the replacement becomes primary and this
        // row loses the designation while turning off.
        const replacementRow =
          replacement === undefined
            ? undefined
            : domains.find(
                (entry) =>
                  entry.id === replacement &&
                  entry.site === row.site &&
                  entry.status === "ACTIVE" &&
                  entry.id !== row.id,
              );
        if (!replacementRow) {
          throw invalid({
            replacement: [
              "Select an active domain on this Site before deactivating the primary.",
            ],
          });
        }
        const now = new Date().toISOString();
        domains = domains.map((entry) => {
          if (entry.id === replacementRow.id) {
            return {
              ...entry,
              is_primary: true,
              // A primary cannot redirect to itself.
              redirect_to_primary: false,
              updated_at: now,
            };
          }
          if (entry.id === row.id) {
            return {
              ...entry,
              is_primary: false,
              status: "INACTIVE" as SiteDomainStatus,
              updated_at: now,
            };
          }
          return entry;
        });
        return respondDomain(
          domains.find((entry) => entry.id === row.id)!,
          mockRequestId(),
        );
      }
      if (replacement !== undefined) {
        throw invalid({
          replacement: [
            "A replacement applies only when deactivating the primary domain.",
          ],
        });
      }
      const updated: SiteDomain = {
        ...row,
        status: "INACTIVE",
        updated_at: new Date().toISOString(),
      };
      domains = domains.map((entry) => (entry.id === row.id ? updated : entry));
      return respondDomain(updated, mockRequestId());
    },

    async makeDomainPrimary(siteId, id, etag) {
      await wait();
      const row = requireDomain(siteId, id);
      checkDomainEtag(row, etag);
      // The model re-checks on the promoted save: an ACTIVE domain cannot be
      // designated through a save on an ARCHIVED Site.
      validateDomainStatus({ status: row.status, site: row.site });
      // designate_primary clears the previous primary inside one domain
      // lock, so the site always keeps exactly one primary.
      const now = new Date().toISOString();
      domains = domains.map((entry) => {
        if (entry.site !== row.site) return entry;
        if (entry.id === row.id) {
          return {
            ...entry,
            is_primary: true,
            redirect_to_primary: false,
            updated_at: now,
          };
        }
        return entry.is_primary
          ? { ...entry, is_primary: false, updated_at: now }
          : entry;
      });
      return respondDomain(
        domains.find((entry) => entry.id === row.id)!,
        mockRequestId(),
      );
    },

    async listModuleAssignments(siteId, query = {}) {
      await wait();
      require(siteId);
      let results = assignments.filter((row) => row.site === siteId);
      if (query.module !== undefined) {
        results = results.filter((row) => row.module === query.module);
      }
      if (query.is_enabled !== undefined) {
        results = results.filter((row) => row.is_enabled === query.is_enabled);
      }
      results.sort((left, right) => left.module - right.module);
      return pageOf(results, query.page);
    },

    async getModuleAssignment(siteId, id) {
      await wait();
      return respondAssignment(
        requireAssignment(siteId, id),
        mockRequestId(),
      );
    },

    async createModuleAssignment(siteId, input) {
      await wait();
      require(siteId);
      const module = requireModule(input.module);
      if (
        assignments.some(
          (row) => row.site === siteId && row.module === input.module,
        )
      ) {
        throw conflict({ module: ["This Site already has this module."] });
      }
      // Model.full_clean normalizes settings before the insert trigger runs,
      // so an unapproved document is a 400 ahead of the usability check.
      validateModuleConfiguration(module, input.configuration ?? {});
      if (!moduleIsUsable(module)) {
        throw invalid({
          module: [
            "A disabled or unimplemented module cannot be enabled for a Site.",
          ],
        });
      }
      const now = new Date().toISOString();
      const created: SiteModuleAssignment = {
        id: nextAssignmentId++,
        site: siteId,
        module: input.module,
        is_enabled: true,
        configuration: { ...(input.configuration ?? {}) },
        created_at: now,
        updated_at: now,
      };
      assignments = [...assignments, created];
      return respondAssignment(created, mockRequestId());
    },

    async enableModuleAssignment(siteId, id, etag) {
      await wait();
      const row = requireAssignment(siteId, id);
      checkEtagAssignment(row, etag);
      // Re-enabling a disabled row re-checks usability in model.clean(); an
      // already-enabled row is an idempotent no-op, exactly as the service.
      if (!row.is_enabled && !moduleIsUsable(requireModule(row.module))) {
        throw invalid({
          module: [
            "A disabled or unimplemented module cannot be enabled for a Site.",
          ],
        });
      }
      const updated: SiteModuleAssignment = {
        ...row,
        is_enabled: true,
        updated_at: new Date().toISOString(),
      };
      assignments = assignments.map((entry) =>
        entry.id === row.id ? updated : entry,
      );
      return respondAssignment(updated, mockRequestId());
    },

    async disableModuleAssignment(siteId, id, etag) {
      await wait();
      const row = requireAssignment(siteId, id);
      checkEtagAssignment(row, etag);
      // Disabling flips a flag only: the row and its configuration stay, so
      // later re-enabling restores exactly the settings that were stored.
      const updated: SiteModuleAssignment = {
        ...row,
        is_enabled: false,
        updated_at: new Date().toISOString(),
      };
      assignments = assignments.map((entry) =>
        entry.id === row.id ? updated : entry,
      );
      return respondAssignment(updated, mockRequestId());
    },

    async updateModuleAssignment(siteId, id, etag, configuration) {
      await wait();
      const row = requireAssignment(siteId, id);
      checkEtagAssignment(row, etag);
      const module = requireModule(row.module);
      // PATCH replaces the settings document wholesale and never touches
      // enablement (`is_enabled` is read-only on the endpoint).
      validateModuleConfiguration(module, configuration);
      const updated: SiteModuleAssignment = {
        ...row,
        configuration: { ...configuration },
        updated_at: new Date().toISOString(),
      };
      assignments = assignments.map((entry) =>
        entry.id === row.id ? updated : entry,
      );
      return respondAssignment(updated, mockRequestId());
    },

    async listModules(query = {}) {
      await wait();
      let results = [...moduleFixtures];
      if (query.search) {
        const needle = query.search.trim().toLowerCase();
        results = results.filter(
          (entry) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.code.toLowerCase().includes(needle),
        );
      }
      if (query.status) {
        results = results.filter((entry) => entry.status === query.status);
      }
      results.sort((left, right) => left.code.localeCompare(right.code));
      return pageOf(results, query.page);
    },

    async listTemplates() {
      await wait();
      const results = siteTemplateFixtures.map((template) => ({ ...template }));
      return {
        count: results.length,
        next: null,
        previous: null,
        results,
      } satisfies PaginatedResponse<SiteTemplate>;
    },

    async getTemplate(id) {
      await wait();
      const found = siteTemplateFixtures.find((template) => template.id === id);
      if (!found) {
        throw new ApiError("The requested resource was not found.", 404, {
          code: "not_found",
        });
      }
      return {
        data: { ...found },
        etag: `"mock-template-${found.id}-${found.updated_at}"`,
        requestId: mockRequestId(),
      };
    },

    async create(input) {
      await wait();
      const code = input.code.trim().toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        throw invalid({
          code: [
            "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
          ],
        });
      }
      if (store.some((site) => site.code === code)) {
        throw conflict({ code: ["A Site with this code already exists."] });
      }
      if (!input.name || input.name.trim() === "") {
        throw invalid({ name: ["A Site name is required."] });
      }

      const defaultLanguage = (input.default_language ?? "en-us").trim().toLowerCase();
      if (!LANGUAGE_CODE.test(defaultLanguage)) {
        throw invalid({
          default_language: ["Use a normalized language code such as en, am or en-us."],
        });
      }

      const organizationUnit = input.organization_unit;
      const isMain = input.is_main ?? false;
      validateNewOwner(organizationUnit, isMain);

      // Provisioning: template defaults (or factory defaults) plus the
      // optional allowlisted merge — exactly like `provision_site`.
      let configuration = defaultSiteConfiguration(defaultLanguage);
      if (input.template !== undefined && input.template !== null) {
        const template = siteTemplateFixtures.find((t) => t.id === input.template);
        if (!template) {
          throw invalid({ template: ["Unknown template."] });
        }
        if (template.status !== "ACTIVE") {
          throw invalid({
            template: ["An inactive template cannot be selected for a new Site."],
          });
        }
        configuration = {
          ...template.default_configuration,
          language: {
            enabled: [...template.default_configuration.language.enabled],
          },
        };
        if (!configuration.language.enabled.includes(defaultLanguage)) {
          configuration.language.enabled.push(defaultLanguage);
        }
      }
      if (input.configuration) {
        configuration = mergeSiteConfiguration(configuration, input.configuration, {
          defaultLanguage,
        });
      }

      const now = new Date().toISOString();
      const created: Site = {
        id: nextId++,
        code,
        name: input.name.trim(),
        short_name: input.short_name?.trim() ?? "",
        organization_unit: organizationUnit,
        default_language: defaultLanguage,
        status: "DRAFT",
        is_main: isMain,
        template: input.template ?? null,
        configuration,
        created_at: now,
        updated_at: now,
      };
      store.push(created);
      return respond(created, mockRequestId());
    },

    async update(id, etag, input) {
      await wait();
      const site = require(id);
      checkEtag(site, etag);

      const nextOwner = input.organization_unit ?? site.organization_unit;
      const nextMain = input.is_main ?? site.is_main;

      if (
        site.status === "ARCHIVED" &&
        (nextOwner !== site.organization_unit || nextMain !== site.is_main)
      ) {
        throw invalid({
          organization_unit: [
            "Archived Site ownership and main designation cannot be changed.",
          ],
        });
      }
      if (nextOwner !== site.organization_unit || input.is_main !== undefined) {
        validateNewOwner(nextOwner, nextMain);
      }

      let configuration = site.configuration;
      if (
        input.default_language !== undefined &&
        input.default_language !== site.default_language
      ) {
        const language = input.default_language.trim().toLowerCase();
        if (!LANGUAGE_CODE.test(language)) {
          throw invalid({
            default_language: ["Use a normalized language code such as en, am or en-us."],
          });
        }
        try {
          // The backend re-normalizes the stored document against the new
          // default language; a default outside the enabled list is a 400
          // under the `configuration` key, exactly as the API reports it.
          configuration = mergeSiteConfiguration(site.configuration, {}, {
            defaultLanguage: language,
          });
        } catch (error) {
          if (error instanceof SiteConfigurationError) throw invalid(error.details);
          throw error;
        }
      }

      const updated: Site = {
        ...site,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.short_name !== undefined
          ? { short_name: input.short_name.trim() }
          : {}),
        ...(input.organization_unit !== undefined
          ? { organization_unit: input.organization_unit }
          : {}),
        ...(input.default_language !== undefined
          ? { default_language: input.default_language.trim().toLowerCase() }
          : {}),
        ...(input.is_main !== undefined ? { is_main: input.is_main } : {}),
        ...(input.template !== undefined ? { template: input.template } : {}),
        configuration,
        updated_at: new Date().toISOString(),
      };
      store = store.map((site) => (site.id === id ? updated : site));
      return respond(updated, mockRequestId());
    },

    async updateConfiguration(id, etag, changes) {
      await wait();
      const site = require(id);
      checkEtag(site, etag);

      let merged: SiteConfiguration;
      try {
        merged = mergeSiteConfiguration(site.configuration, changes, {
          defaultLanguage: site.default_language,
        });
      } catch (error) {
        if (error instanceof SiteConfigurationError) throw invalid(error.details);
        throw error;
      }

      const updated: Site = {
        ...site,
        configuration: merged,
        updated_at: new Date().toISOString(),
      };
      store = store.map((site) => (site.id === id ? updated : site));
      return respond(updated, mockRequestId());
    },

    async activate(id, etag) {
      await wait();
      return transition(id, etag, "ACTIVE");
    },

    async suspend(id, etag) {
      await wait();
      return transition(id, etag, "SUSPENDED");
    },

    async archive(id, etag) {
      await wait();
      return transition(id, etag, "ARCHIVED");
    },
  };
}

/** Deep-clone a configuration document without structuredClone assumptions. */
function structuredCloneSafe(document: Site["configuration"]): Site["configuration"] {
  return JSON.parse(JSON.stringify(document)) as Site["configuration"];
}
