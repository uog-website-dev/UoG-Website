/**
 * Typed fetch wrapper for the UoG Django REST API.
 *
 * Both frontend apps import this package so API access stays consistent.
 * See ./client.ts for the transport, ./errors.ts for structured errors and
 * ./adapters for the swappable live/mock data sources.
 *
 * The public surface is:
 *
 *   - `createApiClient` — low-level typed HTTP client (request ids, ETags,
 *     structured errors, token redaction).
 *   - `createOrganizationsAdapter` / `createSitesAdapter` — resource-level
 *     adapters that pick the live API or local fixtures based on the
 *     explicit API_MODE (see ./adapters/mode.ts).
 *   - `ApiError` — the single error type every failure is surfaced as.
 */
export {
  ApiError,
  apiErrorFromResponse,
  codeForStatus,
  redactCredentials,
} from "./errors";
export type { ApiErrorCode } from "./errors";

export { createApiClient, describeApiError } from "./client";
export type { ApiClient, ApiClientOptions, ApiResult } from "./client";

export { buildQueryString, withQuery } from "./query";
export type { QueryValue } from "./query";

// Resource adapters.
export {
  createLiveOrganizationsAdapter,
  createMockOrganizationsAdapter,
  organizationListQueryString,
  ORGANIZATIONS_PAGE_SIZE,
} from "./adapters/organizations";
export type {
  OrganizationsAdapter,
  OrganizationCreateInput,
  OrganizationUpdateInput,
} from "./adapters/organizations";

export {
  createLiveSitesAdapter,
  createMockSitesAdapter,
  siteListQueryString,
  SITES_PAGE_SIZE,
} from "./adapters/sites";
export type {
  SitesAdapter,
  SiteCreateInput,
  SiteUpdateInput,
  SiteDomainListQuery,
  SiteModuleListQuery,
  PlatformModuleListQuery,
} from "./adapters/sites";

export {
  SiteConfigurationError,
  defaultSiteConfiguration,
  mergeSiteConfiguration,
  hasSecretKey,
  SITE_CONFIGURATION_SCHEMA_VERSION,
  SITE_LANGUAGE_OPTIONS,
  SITE_THEMES,
  SITE_BEHAVIOR_FLAGS,
  SITE_MAX_LANGUAGES,
} from "./sites-configuration";
export type { SiteConfigurationChanges } from "./sites-configuration";

export {
  ApiModeError,
  apiModeFromEnv,
  isNotImplemented,
  resolveApiMode,
} from "./adapters/mode";
export type { ApiMode, ResolveModeOptions } from "./adapters/mode";

export { createOrganizationsAdapter, createSitesAdapter } from "./adapters/factory";

// Fixtures (development only — never used when API_MODE=live).
export { organizationFixtures, rootOrganizationFixture } from "./fixtures/organizations";
export {
  siteFixtures,
  siteTemplateFixtures,
  siteDomainFixtures,
  siteModuleFixtures,
  moduleFixtures,
} from "./fixtures/sites";
