/**
 * Mock fixtures for the Sites screens.
 *
 * Every fixture mirrors a real serialized response from
 * backend/apps/sites/api/serializers.py (`SiteSerializer` and
 * `SiteTemplateSerializer`): field names, status codes, language-code format
 * and the schema-version-1 configuration document are identical to
 * production payloads, so swapping the mock adapter for the live adapter
 * requires no screen changes.
 *
 * These are fixtures for local development only — the live adapter never
 * returns them, and a production build refuses mock mode outright
 * (see ../adapters/mode.ts), so nothing here can be mistaken for real data
 * in a deployed integration.
 */
import type {
  PlatformModule,
  Site,
  SiteConfiguration,
  SiteDomain,
  SiteModuleAssignment,
  SiteTemplate,
} from "@uog/types";

import { defaultSiteConfiguration } from "../sites-configuration";

/** Template defaults as the backend seeds them for the institutional template. */
function institutionalTemplateConfiguration(): SiteConfiguration {
  return defaultSiteConfiguration("en-us");
}

/**
 * Fixture sites, shaped to exercise the console's states:
 *
 *   1. UOG_MAIN    — ACTIVE main property of the UNIVERSITY root, provisioned
 *                    from template 1 with no overrides (fully inherited).
 *   2. COI_PORTAL  — ACTIVE property of a college, provisioned from the same
 *                    template but with explicit overrides (display name,
 *                    languages, search behavior).
 *   3. RESEARCH_LAB — DRAFT property whose owner unit is currently INACTIVE,
 *                    so activation is refused by the backend rules — the
 *                    honest "denied write" case.
 *   4. UOG_PRESS   — SUSPENDED property owned by the *same* root unit as
 *                    UOG_MAIN, proving one organization may own several
 *                    sites (the data model has no owner uniqueness rule).
 *
 * Owning units 1/2/3 refer to `organizationFixtures` in ./organizations.
 * The owners span root, college and department units on purpose: a child
 * site is not assumed to belong to a department — the owning unit's actual
 * type decides what the console shows.
 */
export const siteFixtures: Site[] = [
  {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "UoG",
    organization_unit: 1,
    default_language: "en-us",
    status: "ACTIVE",
    is_main: true,
    template: 1,
    configuration: institutionalTemplateConfiguration(),
    created_at: "2026-10-24T09:53:38.350000Z",
    updated_at: "2026-10-24T09:53:38.350000Z",
  },
  {
    id: 2,
    code: "COI_PORTAL",
    name: "College of Informatics",
    short_name: "CoI",
    organization_unit: 2,
    default_language: "en",
    status: "ACTIVE",
    is_main: false,
    template: 1,
    configuration: {
      ...defaultSiteConfiguration("en"),
      language: { enabled: ["en-us", "en"] },
      identity: {
        display_name: "College of Informatics",
        logo_ref: null,
        favicon_ref: null,
      },
      behavior: { show_search: true, show_language_switcher: false },
    },
    created_at: "2026-10-24T09:53:38.362935Z",
    updated_at: "2026-10-24T09:53:38.362945Z",
  },
  {
    id: 3,
    code: "RESEARCH_LAB",
    name: "Research Portal",
    short_name: "",
    organization_unit: 3,
    default_language: "am",
    status: "DRAFT",
    is_main: false,
    template: null,
    configuration: defaultSiteConfiguration("am"),
    created_at: "2026-10-24T09:53:38.376256Z",
    updated_at: "2026-10-24T09:53:38.376266Z",
  },
  {
    id: 4,
    code: "UOG_PRESS",
    name: "University Press",
    short_name: "UoG Press",
    organization_unit: 1,
    default_language: "en-us",
    status: "SUSPENDED",
    is_main: false,
    template: null,
    configuration: defaultSiteConfiguration("en-us"),
    created_at: "2026-10-24T09:53:38.385000Z",
    updated_at: "2026-10-24T09:53:38.385000Z",
  },
];

/**
 * Hostname rows per site. A domain is a routing record only — it proves
 * neither DNS nor TLS exists, and the console never implies otherwise.
 *
 * Site 3 (RESEARCH_LAB) deliberately has no domains: a draft site can exist
 * with none registered.
 */
export const siteDomainFixtures: SiteDomain[] = [
  {
    id: 1,
    site: 1,
    hostname: "www.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: "2026-10-24T09:53:38.350000Z",
    updated_at: "2026-10-24T09:53:38.350000Z",
  },
  {
    id: 2,
    site: 1,
    hostname: "uog.edu.et",
    is_primary: false,
    redirect_to_primary: true,
    status: "ACTIVE",
    created_at: "2026-10-24T09:53:38.351000Z",
    updated_at: "2026-10-24T09:53:38.351000Z",
  },
  {
    id: 3,
    site: 2,
    hostname: "informatics.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: "2026-10-24T09:53:38.362935Z",
    updated_at: "2026-10-24T09:53:38.362935Z",
  },
  {
    id: 4,
    site: 4,
    hostname: "press.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "INACTIVE",
    created_at: "2026-10-24T09:53:38.385000Z",
    updated_at: "2026-10-24T09:53:38.385000Z",
  },
];

/**
 * The platform module registry, mirroring the seeded rows: every capability
 * is PLANNED and globally disabled, because registering a row does not
 * implement a feature (see docs/api/sites.md). Consequently no site has any
 * enabled module, and the console says so rather than inventing features.
 */
export const moduleFixtures: PlatformModule[] = [
  {
    id: 1,
    code: "CMS",
    name: "Content management",
    description: "Page authoring and publishing.",
    status: "PLANNED",
    is_enabled: false,
    configuration_schema: {},
    created_at: "2026-10-24T09:53:38.200000Z",
    updated_at: "2026-10-24T09:53:38.200000Z",
  },
  {
    id: 2,
    code: "MEDIA",
    name: "Media library",
    description: "Shared asset storage for sites.",
    status: "PLANNED",
    is_enabled: false,
    configuration_schema: {},
    created_at: "2026-10-24T09:53:38.210000Z",
    updated_at: "2026-10-24T09:53:38.210000Z",
  },
  {
    id: 3,
    code: "ANALYTICS",
    name: "Analytics",
    description: "Usage measurement.",
    status: "PLANNED",
    is_enabled: false,
    configuration_schema: {},
    created_at: "2026-10-24T09:53:38.220000Z",
    updated_at: "2026-10-24T09:53:38.220000Z",
  },
];

/**
 * Per-site module assignments. Empty on purpose: enabling a module requires
 * a shipped, globally enabled capability, and the seeded registry has none —
 * so no honest fixture may claim a site runs one.
 */
export const siteModuleFixtures: SiteModuleAssignment[] = [];

/**
 * Fixture templates for the create form's template selector and for the
 * inherited-vs-override comparison on the detail/edit screens.
 */
export const siteTemplateFixtures: SiteTemplate[] = [
  {
    id: 1,
    code: "INSTITUTIONAL",
    name: "Institutional default",
    description: "Standard university website defaults.",
    status: "ACTIVE",
    default_configuration: institutionalTemplateConfiguration(),
    created_at: "2026-10-24T09:53:38.100000Z",
    updated_at: "2026-10-24T09:53:38.100000Z",
  },
  {
    id: 2,
    code: "LEGACY_PORTAL",
    name: "Legacy portal",
    description: "Retired template — cannot be selected for new sites.",
    status: "INACTIVE",
    default_configuration: defaultSiteConfiguration("en-us"),
    created_at: "2026-10-24T09:53:38.110000Z",
    updated_at: "2026-10-24T09:53:38.110000Z",
  },
];
