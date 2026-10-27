/**
 * Typed helpers for the versioned Site configuration document.
 *
 * The backend stores a *versioned allowlist*, not a free-form blob
 * (backend/apps/sites/configuration.py, docs/architecture/site-configuration.md).
 * This module mirrors just enough of that contract for the console:
 *
 *   - `defaultSiteConfiguration` builds the schema-version-1 defaults the
 *     backend factory produces for a new site;
 *   - `mergeSiteConfiguration` applies an allowlisted partial change exactly
 *     the way `merge_site_configuration` does, so the mock adapter behaves
 *     like the API;
 *   - `hasSecretKey` applies the same secret-key rejection (password, secret,
 *     token, credential, api key, private key, session) so a client can warn
 *     *before* a round trip.
 *
 * None of this is a security boundary: the Django serializer and the
 * PostgreSQL configuration check remain the sole authorities, and their 400
 * responses are rendered verbatim. This only gives immediate feedback and
 * keeps the mock honest.
 */
import type { SiteConfiguration, SiteTheme } from "@uog/types";

/** Current schema version the backend accepts. */
export const SITE_CONFIGURATION_SCHEMA_VERSION = 1;

/** Approved themes (backend `THEMES`). */
export const SITE_THEMES: readonly SiteTheme[] = [
  "institutional",
  "high-contrast",
];

/** Boolean behavior flags (backend `BEHAVIOR_FLAGS`). */
export const SITE_BEHAVIOR_FLAGS = [
  "show_search",
  "show_language_switcher",
] as const;

/** Sections of the document that may appear in a partial change. */
export const SITE_CONFIGURATION_SECTIONS = [
  "identity",
  "language",
  "presentation",
  "navigation",
  "behavior",
] as const;

/** Backend limit on enabled languages. */
export const SITE_MAX_LANGUAGES = 10;

/** Backend limit on navigation items. */
export const SITE_MAX_NAV_ITEMS = 20;

/** The platform's approved language choices for site forms. */
export const SITE_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "en", label: "English (en)" },
  { value: "am", label: "Amharic (am)" },
  { value: "en-us", label: "English (US) (en-us)" },
  { value: "fr", label: "French (fr)" },
  { value: "sw", label: "Swahili (sw)" },
];

/** Mirrors the backend SECRET_KEY regex — informational, never authoritative. */
const SECRET_KEY_PATTERN =
  /password|secret|token|credential|api_key|private_key|session/i;

/**
 * True when any key anywhere in the value looks like a credential.
 * The backend rejects such documents with 400; the console uses this to
 * refuse to send them in the first place and to explain why.
 */
export function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) return true;
      if (hasSecretKey(child)) return true;
    }
  }
  return false;
}

/**
 * Schema-version-1 defaults for one site language, matching
 * `default_configuration()` on the backend: callers may mutate the result.
 */
export function defaultSiteConfiguration(
  defaultLanguage = "en-us",
): SiteConfiguration {
  return {
    schema_version: SITE_CONFIGURATION_SCHEMA_VERSION,
    identity: { display_name: null, logo_ref: null, favicon_ref: null },
    language: { enabled: [defaultLanguage] },
    presentation: { theme: "institutional" },
    navigation: { items: [] },
    behavior: { show_search: false, show_language_switcher: false },
  };
}

/**
 * A partial, allowlisted configuration change — the body of
 * `PATCH /sites/{id}/configuration/` (and the optional create-time merge).
 */
export interface SiteConfigurationChanges {
  schema_version?: number;
  identity?: Partial<SiteConfiguration["identity"]>;
  /** Replaces the enabled list wholesale (backend behaviour). */
  language?: SiteConfiguration["language"];
  presentation?: Partial<SiteConfiguration["presentation"]>;
  navigation?: SiteConfiguration["navigation"];
  behavior?: Partial<SiteConfiguration["behavior"]>;
}

/**
 * Merge an allowlisted partial change onto a document, mirroring the
 * backend. Throws `SiteConfigurationError` with a `{field: [messages]}` map
 * shaped like a DRF 400 body so screens can render it unchanged.
 */
export class SiteConfigurationError extends Error {
  readonly details: Record<string, string[]>;

  constructor(details: Record<string, string[]>) {
    const text = Object.values(details).flat().join(" ");
    super(text);
    this.name = "SiteConfigurationError";
    this.details = details;
  }
}

export function mergeSiteConfiguration(
  current: SiteConfiguration,
  changes: SiteConfigurationChanges,
  options: { defaultLanguage?: string } = {},
): SiteConfiguration {
  const fail = (message: string): never => {
    throw new SiteConfigurationError({ configuration: [message] });
  };

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return fail("Configuration must be a JSON object.");
  }
  if (hasSecretKey(changes)) {
    return fail("Site configuration cannot store secrets.");
  }

  const unknown = Object.keys(changes).filter(
    (key) =>
      !(SITE_CONFIGURATION_SECTIONS as readonly string[]).includes(key) &&
      key !== "schema_version",
  );
  if (
    unknown.length > 0 ||
    (changes.schema_version !== undefined &&
      changes.schema_version !== SITE_CONFIGURATION_SCHEMA_VERSION)
  ) {
    return fail("Unsupported configuration properties.");
  }

  const merged: SiteConfiguration = {
    ...current,
    identity: { ...current.identity },
    language: { ...current.language, enabled: [...current.language.enabled] },
    presentation: { ...current.presentation },
    navigation: {
      items: current.navigation.items.map((item) => ({ ...item })),
    },
    behavior: { ...current.behavior },
  };

  for (const section of SITE_CONFIGURATION_SECTIONS) {
    const value = changes[section];
    if (value === undefined) continue;

    if (section === "language" || section === "navigation") {
      // These sections replace wholesale, exactly like the backend.
      Object.assign(merged, { [section]: value });
      continue;
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail(`Configuration ${section} must be an object.`);
    }
    const extra = Object.keys(value).filter(
      (key) => !(key in (current[section] as object)),
    );
    if (extra.length > 0) {
      return fail("Unsupported configuration properties.");
    }
    Object.assign(merged[section], value);
  }

  // Schema v1 rules the console can check cheaply for instant feedback.
  const display = merged.identity.display_name;
  if (
    display !== null &&
    (typeof display !== "string" ||
      display.trim() === "" ||
      display !== display.trim() ||
      display.length > 255)
  ) {
    return fail("Identity display_name must be null or a nonblank name.");
  }

  const enabled = merged.language.enabled;
  const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
  if (
    !Array.isArray(enabled) ||
    enabled.length < 1 ||
    enabled.length > SITE_MAX_LANGUAGES ||
    new Set(enabled).size !== enabled.length ||
    enabled.some((code) => typeof code !== "string" || !LANGUAGE_CODE.test(code)) ||
    (options.defaultLanguage !== undefined &&
      !enabled.includes(options.defaultLanguage))
  ) {
    return fail(
      "Enabled languages must include the Site default language.",
    );
  }

  if (!SITE_THEMES.includes(merged.presentation.theme)) {
    return fail("Presentation theme is not approved.");
  }

  const items = merged.navigation.items;
  const NAV_CODE = /^[A-Z][A-Z0-9_-]{0,31}$/;
  const NAV_PATH = /^\/(?:[a-z0-9][a-z0-9_-]{0,63}(?:\/[a-z0-9][a-z0-9_-]{0,63})*)?$/;
  if (!Array.isArray(items) || items.length > SITE_MAX_NAV_ITEMS) {
    return fail("Navigation items do not match the approved schema.");
  }
  const navCodes: string[] = [];
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.code !== "string" ||
      !NAV_CODE.test(item.code) ||
      typeof item.label !== "string" ||
      item.label.trim() === "" ||
      item.label !== item.label.trim() ||
      item.label.length > 80 ||
      typeof item.path !== "string" ||
      !NAV_PATH.test(item.path)
    ) {
      return fail("Navigation items do not match the approved schema.");
    }
    navCodes.push(item.code);
  }
  if (new Set(navCodes).size !== navCodes.length) {
    return fail("Navigation codes must be unique.");
  }

  for (const flag of SITE_BEHAVIOR_FLAGS) {
    if (typeof merged.behavior[flag] !== "boolean") {
      return fail("Behavior settings must be boolean.");
    }
  }

  return merged;
}
