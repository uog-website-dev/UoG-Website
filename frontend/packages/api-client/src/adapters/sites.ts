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

/** Validated filters for GET /sites/{id}/modules/. */
export interface SiteModuleListQuery {
  is_enabled?: boolean;
  page?: number;
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
  /** One site's module enablement rows (empty until a capability ships). */
  listModuleAssignments(
    siteId: number,
    query?: SiteModuleListQuery,
  ): Promise<PaginatedResponse<SiteModuleAssignment>>;
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
    async listModuleAssignments(siteId, query) {
      const path = withQuery(
        `${SITES_PATH}${siteId}/modules/`,
        buildQueryString({
          is_enabled:
            query?.is_enabled === undefined
              ? undefined
              : String(query.is_enabled),
          page: query?.page,
        }),
      );
      return client.get<PaginatedResponse<SiteModuleAssignment>>(path);
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
      let results = siteDomainFixtures.filter((domain) => domain.site === siteId);
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

    async listModuleAssignments(siteId, query = {}) {
      await wait();
      require(siteId);
      let results = siteModuleFixtures.filter((row) => row.site === siteId);
      if (query.is_enabled !== undefined) {
        results = results.filter((row) => row.is_enabled === query.is_enabled);
      }
      results.sort((left, right) => left.module - right.module);
      return pageOf(results, query.page);
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
