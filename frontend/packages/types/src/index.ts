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
 * A managed site (public website or microsite).
 *
 * PROVISIONAL: the Django backend does not expose a Sites API yet (there is
 * no `sites` app). This DTO documents the shape the admin console needs so
 * the screen and its mock fixtures are built against a stable contract; it
 * will be reconciled with the real serializer when that endpoint lands.
 *
 * Until then the live adapter refuses to return data (see
 * @uog/api-client's `createLiveSitesAdapter`) rather than fabricating a
 * response, so a deployed integration never presents invented sites as
 * real.
 */
export type SiteStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Site {
  id: number;
  name: string;
  slug: string;
  organization: number | null;
  status: SiteStatus;
  domains: string[];
  created_at: string;
  updated_at: string;
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
