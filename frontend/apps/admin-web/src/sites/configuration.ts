/**
 * Inherited-vs-override comparison for a Site's configuration.
 *
 * A Site's settings document is seeded once at provisioning: either from the
 * selected template's approved defaults (`SiteTemplate.default_configuration`)
 * or from the schema factory defaults when no template was chosen. Later
 * edits go through `PATCH /sites/{id}/configuration/`, which merges an
 * allowlisted partial change onto that document — the template row itself is
 * never rewritten.
 *
 * That gives the console an honest way to show provenance without inventing
 * an inheritance engine: a value is **inherited** when the Site's stored
 * document still equals the provisioning baseline for that field, and an
 * **override** when it differs. The backend stores no per-field provenance,
 * so this comparison is derived from the two documents the API actually
 * returns — nothing here claims more than that.
 */
import type { Site, SiteConfiguration } from "@uog/types";
import { defaultSiteConfiguration } from "@uog/api-client";

export type ConfigOrigin = "inherited" | "override";

export interface ConfigurationRow {
  /** Stable key for React lists. */
  key: string;
  label: string;
  /** Human-readable current value. */
  value: string;
  origin: ConfigOrigin;
  /** Monospace rendering for media keys and codes. */
  monospace?: boolean;
}

/**
 * The baseline a Site was provisioned from: its template's defaults, or the
 * schema factory defaults when it has no template.
 */
export function baselineFor(
  site: Site,
  templateDefaults: SiteConfiguration | null | undefined,
): SiteConfiguration {
  return templateDefaults ?? defaultSiteConfiguration(site.default_language);
}

/** Deep equality for small JSON documents. */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function origin(current: unknown, baseline: unknown): ConfigOrigin {
  return sameValue(current, baseline) ? "inherited" : "override";
}

function display(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function yesNo(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

/**
 * Rows for the configuration panel, each labelled inherited or override
 * against the provisioning baseline.
 */
export function configurationRows(
  site: Site,
  templateDefaults: SiteConfiguration | null | undefined,
): ConfigurationRow[] {
  const current = site.configuration;
  const baseline = baselineFor(site, templateDefaults);

  const rows: ConfigurationRow[] = [
    {
      key: "display_name",
      label: "Display name",
      value: display(current.identity.display_name, "Uses the site name"),
      origin: origin(current.identity.display_name, baseline.identity.display_name),
    },
    {
      key: "default_language",
      label: "Default language",
      value: site.default_language,
      // The default language is a real column, not part of the merged
      // document, so it is always the Site's own value.
      origin: "override",
    },
    {
      key: "enabled_languages",
      label: "Enabled languages",
      value: current.language.enabled.join(", "),
      origin: origin(current.language.enabled, baseline.language.enabled),
    },
    {
      key: "theme",
      label: "Theme",
      value:
        SITE_THEME_LABELS[
          current.presentation.theme as keyof typeof SITE_THEME_LABELS
        ] ?? current.presentation.theme,
      origin: origin(current.presentation, baseline.presentation),
    },
    {
      key: "show_search",
      label: "Search box",
      value: yesNo(current.behavior.show_search),
      origin: origin(current.behavior.show_search, baseline.behavior.show_search),
    },
    {
      key: "show_language_switcher",
      label: "Language switcher",
      value: yesNo(current.behavior.show_language_switcher),
      origin: origin(
        current.behavior.show_language_switcher,
        baseline.behavior.show_language_switcher,
      ),
    },
    {
      key: "logo_ref",
      label: "Logo reference",
      value: display(current.identity.logo_ref, "None"),
      origin: origin(current.identity.logo_ref, baseline.identity.logo_ref),
      monospace: true,
    },
    {
      key: "favicon_ref",
      label: "Favicon reference",
      value: display(current.identity.favicon_ref, "None"),
      origin: origin(current.identity.favicon_ref, baseline.identity.favicon_ref),
      monospace: true,
    },
    {
      key: "navigation",
      label: "Navigation items",
      value:
        current.navigation.items.length === 0
          ? "None"
          : current.navigation.items
              .map((item) => `${item.label} (${item.path})`)
              .join(", "),
      origin: origin(current.navigation.items, baseline.navigation.items),
    },
  ];

  return rows;
}

const SITE_THEME_LABELS: Record<string, string> = {
  institutional: "Institutional",
  "high-contrast": "High contrast",
};

/** Human summary of what a row's origin means, for captions and legends. */
export function originCaption(
  origin: ConfigOrigin,
  baselineLabel: string,
): string {
  return origin === "inherited"
    ? `Inherited from ${baselineLabel}`
    : `Override of ${baselineLabel}`;
}
