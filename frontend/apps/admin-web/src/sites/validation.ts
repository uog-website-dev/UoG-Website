/**
 * Controlled options and client-side validation for the site create/edit
 * form.
 *
 * The backend is the sole authority on what is valid. This module only gives
 * *immediate, usable feedback* before a round trip and keeps selects
 * controlled. It mirrors documented rules (backend/apps/sites,
 * docs/architecture/site-data-model.md) but deliberately does not reproduce
 * the state-dependent lifecycle/topology ruleset: those are enforced by
 * `sites_validate_lifecycle` in PostgreSQL, whose failures arrive as
 * structured 400/409 responses the form displays verbatim.
 *
 * Nothing here authorizes a write — it only shapes messages.
 */
import type { Site, SiteStatus } from "@uog/types";
import type { SiteConfigurationChanges, SiteCreateInput, SiteUpdateInput } from "@uog/api-client";
import {
  SITE_LANGUAGE_OPTIONS,
  SITE_THEMES,
} from "@uog/api-client";

/** Lifecycle choices the list filter may send (matches the model's choices). */
export const SITE_STATUS_OPTIONS: ReadonlyArray<{
  value: SiteStatus;
  label: string;
}> = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Human label for a status code. */
export function siteStatusLabel(status: SiteStatus): string {
  return (
    SITE_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    status
  );
}

/** Status chip colours, kept consistent across every admin screen. */
export function siteStatusChip(status: SiteStatus): {
  color: "default" | "success" | "warning" | "error";
  label: string;
} {
  switch (status) {
    case "ACTIVE":
      return { color: "success", label: "Active" };
    case "DRAFT":
      return { color: "default", label: "Draft" };
    case "SUSPENDED":
      return { color: "warning", label: "Suspended" };
    case "ARCHIVED":
      return { color: "error", label: "Archived" };
  }
}

/** Theme choices for the presentation select. */
export const SITE_THEME_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "institutional", label: "Institutional" },
  { value: "high-contrast", label: "High contrast" },
];

/** Canonical code pattern, mirroring the model's RegexValidator. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;
/** Normalized language-code pattern from the model validator. */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

/** Max lengths from the model fields, so the form can fail fast locally. */
const MAX = { code: 64, name: 255, shortName: 100, displayName: 255 } as const;

export interface SiteFormValues {
  code: string;
  name: string;
  short_name: string;
  /** Select value: `""` means "not chosen yet". */
  organization_unit: string;
  default_language: string;
  is_main: boolean;
  /** Select value: `""` means "no template" (platform defaults). */
  template: string;
  /** Configuration: `""` means null (fall back to `Site.name`). */
  display_name: string;
  /** Enabled language codes; must include `default_language`. */
  enabled_languages: string[];
  theme: string;
  show_search: boolean;
  show_language_switcher: boolean;
}

/** Normalize a code the way the serializer does: trim and upper-case. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Empty create state: default language en, enabled set starts with it. */
export function emptySiteForm(): SiteFormValues {
  return {
    code: "",
    name: "",
    short_name: "",
    organization_unit: "",
    default_language: "en",
    is_main: false,
    template: "",
    display_name: "",
    enabled_languages: ["en", "am"],
    theme: "institutional",
    show_search: false,
    show_language_switcher: false,
  };
}

/** Seed the form from an existing site (edit mode). */
export function formValuesFromSite(site: Site): SiteFormValues {
  return {
    code: site.code,
    name: site.name,
    short_name: site.short_name ?? "",
    organization_unit: String(site.organization_unit),
    default_language: site.default_language,
    is_main: site.is_main,
    template: site.template === null ? "" : String(site.template),
    display_name: site.configuration.identity.display_name ?? "",
    enabled_languages: [...site.configuration.language.enabled],
    theme: site.configuration.presentation.theme,
    show_search: site.configuration.behavior.show_search,
    show_language_switcher: site.configuration.behavior.show_language_switcher,
  };
}

/**
 * Field errors a client can determine *without* the server.
 *
 * Returns `{}` when the form looks acceptable — never a claim that it *is*
 * acceptable. Duplicate codes, owner/topology violations and lifecycle rules
 * are the server's call and are not pre-judged here.
 */
export function validateSiteForm(
  values: SiteFormValues,
  options: { mode: "create" | "edit" },
): Record<string, string> {
  const errors: Record<string, string> = {};

  const code = normalizeCode(values.code);
  if (options.mode === "create") {
    if (code === "") {
      errors.code = "A code is required.";
    } else if (!CODE_PATTERN.test(code)) {
      errors.code =
        "Use an uppercase letter followed by up to 63 uppercase letters, digits, underscores or hyphens.";
    } else if (code.length > MAX.code) {
      errors.code = `Codes are limited to ${MAX.code} characters.`;
    }
  }

  const name = values.name.trim();
  if (name === "") {
    errors.name = "A name is required.";
  } else if (values.name.length > MAX.name) {
    errors.name = `Names are limited to ${MAX.name} characters.`;
  }

  if (values.short_name.length > MAX.shortName) {
    errors.short_name = `Short names are limited to ${MAX.shortName} characters.`;
  }

  if (values.organization_unit === "") {
    errors.organization_unit = "Choose the owning organization unit.";
  } else if (!/^\d+$/.test(values.organization_unit)) {
    errors.organization_unit = "The owner must be an existing organization unit.";
  }

  const language = values.default_language.trim();
  if (language === "") {
    errors.default_language = "A default language is required.";
  } else if (!LANGUAGE_PATTERN.test(language)) {
    errors.default_language =
      "Use a normalized language code such as en, am or en-us.";
  }

  const enabled = values.enabled_languages;
  if (enabled.length === 0) {
    errors.enabled_languages = "Enable at least one language.";
  } else if (enabled.length > 10) {
    errors.enabled_languages = "At most ten languages can be enabled.";
  } else if (new Set(enabled).size !== enabled.length) {
    errors.enabled_languages = "Languages must be unique.";
  } else if (enabled.some((code) => !LANGUAGE_PATTERN.test(code))) {
    errors.enabled_languages = "Use normalized codes such as en or en-us.";
  } else if (language !== "" && !enabled.includes(language)) {
    errors.enabled_languages =
      "The enabled languages must include the default language.";
  }

  if (values.display_name.length > MAX.displayName) {
    errors.display_name = `Display names are limited to ${MAX.displayName} characters.`;
  } else if (values.display_name !== "" && values.display_name !== values.display_name.trim()) {
    errors.display_name = "Display names cannot start or end with spaces.";
  }

  if (!SITE_THEMES.includes(values.theme as (typeof SITE_THEMES)[number])) {
    errors.theme = "Choose an approved theme.";
  }

  return errors;
}

/**
 * Build the `POST /sites/` payload. `status` is never sent (new sites are
 * always DRAFT) and `configuration` carries only the typed, allowlisted
 * fields this form owns — never free-form JSON, so no secret can be typed in.
 */
export function buildCreateInput(values: SiteFormValues): SiteCreateInput {
  const input: SiteCreateInput = {
    code: normalizeCode(values.code),
    name: values.name.trim(),
    organization_unit: Number(values.organization_unit),
    short_name: values.short_name.trim(),
    default_language: values.default_language.trim(),
    is_main: values.is_main,
    template: values.template === "" ? null : Number(values.template),
    configuration: buildConfigurationChanges(values),
  };
  return input;
}

/**
 * Build the `PATCH /sites/{id}/` payload. `code`, `status` and
 * `configuration` are not writable on that endpoint, so they are never sent.
 */
export function buildUpdateInput(values: SiteFormValues): SiteUpdateInput {
  return {
    name: values.name.trim(),
    short_name: values.short_name.trim(),
    organization_unit: Number(values.organization_unit),
    default_language: values.default_language.trim(),
    is_main: values.is_main,
    template: values.template === "" ? null : Number(values.template),
  };
}

/**
 * Build the allowlisted configuration change for `PATCH .../configuration/`.
 * Only the typed sections this form owns are emitted; an untouched section is
 * omitted so the backend merge leaves it alone.
 */
export function buildConfigurationChanges(
  values: SiteFormValues,
): SiteConfigurationChanges {
  return {
    identity: {
      display_name: values.display_name.trim() === "" ? null : values.display_name.trim(),
    },
    language: { enabled: values.enabled_languages },
    presentation: {
      theme: values.theme as "institutional" | "high-contrast",
    },
    behavior: {
      show_search: values.show_search,
      show_language_switcher: values.show_language_switcher,
    },
  };
}

/**
 * Language choices for the selects/checkboxes: the approved platform list
 * plus any code the site already has enabled (the server may hold codes a
 * seeded list does not know, and it remains the authority on validity).
 */
export function languageOptions(
  extra: readonly string[] = [],
): Array<{ value: string; label: string }> {
  const options = new Map(SITE_LANGUAGE_OPTIONS.map((option) => [option.value, option]));
  for (const code of extra) {
    if (!options.has(code)) {
      options.set(code, { value: code, label: code });
    }
  }
  return [...options.values()];
}
