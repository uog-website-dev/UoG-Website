/**
 * Shared API/domain types for the UoG Digital Platform.
 *
 * Mirrors the Django REST Framework schemas exposed by the backend
 * (see backend/apps/api). Extend here as new resources land.
 */

/** A CMS page (sample resource proving backend <-> frontend contracts). */
export interface Page {
  id: number;
  title: string;
  slug: string;
  content: string;
  description: string;
  created_at: string;
  updated_at: string;
  is_published: boolean;
}

/** Standard DRF page-number envelope. */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Identity behind a validated Keycloak access token (GET /api/me/). */
export interface Identity {
  username: string;
  email: string;
  name: string;
  roles: string[];
  is_staff: boolean;
  client_id: string;
  scopes: string[];
  expires_at: number;
}

/** Platform overview for administrators (GET /api/admin/overview/). */
export interface AdminOverview {
  pages: number;
  published_pages: number;
  users: number;
  requested_by: string;
}

/**
 * Organization lifecycle states, mirroring `OrganizationUnit.Status` in
 * backend/apps/organizations/models/organization_unit.py.
 */
export type OrganizationStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

/**
 * An organization unit, as serialized by
 * backend/apps/organizations/api/serializers.py::OrganizationSerializer.
 *
 * `organization_type` is the stable type code (e.g. `COLLEGE`), not the
 * type's display name. `parent` is the id of the direct parent, or `null`
 * for roots. `metadata` is a free-form JSON object owned by the domain.
 */
export interface Organization {
  id: number;
  code: string;
  name: string;
  short_name: string;
  organization_type: string;
  parent: number | null;
  description: string;
  status: OrganizationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Validated discovery query parameters for GET /api/v1/organizations/.
 *
 * Mirrors OrganizationDiscoverySerializer in
 * backend/apps/organizations/api/discovery.py. The backend rejects unknown,
 * repeated or invalid parameters with 400, so callers must only send
 * values it accepts.
 */
export interface OrganizationListQuery {
  /** Trimmed, case-insensitive literal substring of name OR code. */
  search?: string;
  /** Case-insensitive literal name substring. */
  name?: string;
  /** Exact code, normalized to uppercase. */
  code?: string;
  /** Exact existing managed organization type code, e.g. COLLEGE. */
  type?: string;
  /** Direct parent bigint id, or the literal "null" for roots. */
  parent?: number | "null";
  /** Exact lifecycle status; omit for all states. */
  status?: OrganizationStatus;
  /** Comma-separated code, name, created_at, updated_at; '-' for descending. */
  ordering?: string;
  /** Page number (1-based), page size fixed at 20 server-side. */
  page?: number;
}

/**
 * Site lifecycle states, mirroring `Site.Status` in
 * backend/apps/sites/models/site.py. New sites always start DRAFT and the
 * transitions are forward-only (see docs/architecture/site-data-model.md).
 */
export type SiteStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";

/** One navigation entry in the versioned site configuration (schema v1). */
export interface SiteNavigationItem {
  code: string;
  label: string;
  /** Same-site path such as `/` or `/about`. */
  path: string;
}

/** Approved presentation themes (backend `THEMES` allowlist). */
export type SiteTheme = "institutional" | "high-contrast";

/**
 * Versioned, allowlisted site settings stored on `Site.configuration`
 * (schema version 1). This is never a free-form document: unknown keys and
 * keys that look like secrets are rejected by the backend, and the console
 * only edits the typed fields below.
 */
export interface SiteConfiguration {
  schema_version: number;
  identity: {
    /** `null` means "use `Site.name`". */
    display_name: string | null;
    logo_ref: string | null;
    favicon_ref: string | null;
  };
  language: {
    /** One to ten unique normalized codes; must include `default_language`. */
    enabled: string[];
  };
  presentation: { theme: SiteTheme };
  navigation: { items: SiteNavigationItem[] };
  behavior: {
    show_search: boolean;
    show_language_switcher: boolean;
  };
}

/**
 * An institutional website, as serialized by
 * backend/apps/sites/api/serializers.py::SiteSerializer.
 *
 * `organization_unit` is the owning unit's id (many sites per owner are
 * allowed), `template` is the provisioning template whose defaults were
 * copied once (or `null`), and `configuration` is the read-only versioned
 * settings document — writable only through the dedicated
 * `PATCH /sites/{id}/configuration/` endpoint, never through `PATCH /sites/{id}/`.
 */
export interface Site {
  id: number;
  code: string;
  name: string;
  short_name: string;
  organization_unit: number;
  default_language: string;
  status: SiteStatus;
  is_main: boolean;
  template: number | null;
  configuration: SiteConfiguration;
  created_at: string;
  updated_at: string;
}

/**
 * Validated list query parameters for GET /api/v1/sites/.
 *
 * Mirrors SiteQuerySerializer in backend/apps/sites/api/query.py: the
 * backend rejects unknown, repeated or invalid parameters with 400.
 */
export interface SiteListQuery {
  /** Case-insensitive substring of name OR code. */
  search?: string;
  /** Exact code, normalized to uppercase. */
  code?: string;
  /** Exact lifecycle status; omit for all states. */
  status?: SiteStatus;
  /** Exact owning organization unit id. */
  organization_unit?: number;
  /** Comma-separated code, name, status, created_at, updated_at; '-' desc. */
  ordering?: string;
  /** Page number (1-based), page size fixed at 20 server-side. */
  page?: number;
}

/**
 * A hostname registered for a Site (backend SiteDomainSerializer).
 *
 * A domain row is a routing record only: it does not prove DNS or TLS
 * exists, and the console never implies that it does. `hostname` is
 * normalized and immutable after creation.
 */
export type SiteDomainStatus = "ACTIVE" | "INACTIVE";

export interface SiteDomain {
  id: number;
  site: number;
  hostname: string;
  is_primary: boolean;
  /** Aliases may redirect to the primary; a primary never redirects. */
  redirect_to_primary: boolean;
  status: SiteDomainStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Validated query for the central Domain Management listing.
 *
 * The platform API has no cross-site domain endpoint yet — domains are read
 * per Site (`GET /api/v1/sites/{site_pk}/domains/`) — so this query is
 * applied by the typed client over the composed result. It mirrors what the
 * per-site endpoint validates (status, is_primary) plus the join filters
 * the console needs (search across hostname and site, exact site).
 */
export interface DomainListQuery {
  /** Case-insensitive substring of hostname, site code or site name. */
  search?: string;
  /** Exact owning Site id. */
  site?: number;
  /** `true` = Primary, `false` = Alias; omit for both. */
  is_primary?: boolean;
  /** Exact domain status; omit for both. */
  status?: SiteDomainStatus;
  /** Comma-separated fields with optional '-'; default `hostname`. */
  ordering?: string;
  /** Page number (1-based), page size fixed at 20. */
  page?: number;
}

/**
 * One domain row for the central Domain Management table: the domain itself
 * plus the Site fields needed to display its context without a second read
 * (`site_code`, `site_name`, `site_status`, `organization_unit`).
 */
export interface DomainRecord extends SiteDomain {
  site_code: string;
  site_name: string;
  site_status: SiteStatus;
  organization_unit: number;
}

/** Registry capability states (backend Module.Status). */
export type ModuleStatus = "PLANNED" | "IMPLEMENTED" | "DEPRECATED";

/**
 * One platform capability in the module registry (backend ModuleSerializer).
 *
 * A registry row is not a working feature: a PLANNED module cannot be
 * enabled for any Site, and registering one does not implement it.
 */
export interface PlatformModule {
  id: number;
  code: string;
  name: string;
  description: string;
  status: ModuleStatus;
  is_enabled: boolean;
  configuration_schema: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * One Site's enablement of one registry module (backend SiteModuleSerializer).
 *
 * Disabling keeps the row and its configuration; it does not delete data.
 * `module` is the registry id — resolve codes/names via GET /api/v1/modules/.
 */
export interface SiteModuleAssignment {
  id: number;
  site: number;
  module: number;
  is_enabled: boolean;
  configuration: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * A site template: the approved defaults copied onto a Site once at
 * provisioning (backend SiteTemplateSerializer). Editing a template never
 * rewrites sites provisioned from it, which is exactly why the console can
 * compare a Site's configuration against its template to show which values
 * are inherited and which are explicit overrides.
 */
export interface SiteTemplate {
  id: number;
  code: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  default_configuration: SiteConfiguration;
  created_at: string;
  updated_at: string;
}

/**
 * Flat organization hierarchy returned by GET /api/v1/organizations/tree/.
 *
 * Breadth-first, code order within each depth, `parent` links nodes. The
 * backend caps the response at 1000 nodes and answers 409 on overflow, so a
 * screen must handle `count` reaching that limit rather than assuming the
 * whole forest is present. No pagination and no depth truncation.
 */
export interface OrganizationHierarchy {
  count: number;
  results: Organization[];
}

/**
 * Detail responses carry a strong ETag required for conditional mutations.
 * `requestId` is the backend correlation id (X-Request-ID) for support.
 */
export interface ETaggedResponse<T> {
  data: T;
  etag: string | null;
  requestId: string | null;
}

/**
 * Structured error envelope returned by every handled backend error, as
 * produced by backend/apps/core/errors.py::api_exception_handler.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
  request_id: string | null;
}

/** Backend readiness report (GET /health/ready). */
export type HealthState = "ok" | "unavailable";

export interface HealthCheck {
  status: string;
  latency_ms?: number;
  detail?: string;
}

export interface HealthReport {
  status: HealthState;
  checks: Record<string, HealthCheck>;
}
