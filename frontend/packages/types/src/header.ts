/**
 * Header presentation is Site-owned; header and utility navigation stay in the
 * existing published menu locations. No HTML, CSS or JavaScript is accepted.
 */
export interface SiteHeaderSettings {
  /** Destination for the logo and Site display name. Same-site path or http(s). */
  brand_href: string;
  /** Search is additionally hidden when neither PAGES nor POSTS is enabled. */
  search_enabled: boolean;
  /** Keep the header visible while the page scrolls. */
  sticky: boolean;
  cta_label: string;
  cta_url: string;
  language_switcher: boolean;
}

export function defaultSiteHeader(): SiteHeaderSettings {
  return {
    brand_href: "/",
    search_enabled: true,
    sticky: false,
    cta_label: "",
    cta_url: "",
    language_switcher: false,
  };
}

const SITE_PATH = /^\/(?:[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})*)?$/;

/** Same allowlist as the backend: a same-site path or an absolute http(s) URL. */
export function safeHeaderHref(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (value.startsWith("/")) return SITE_PATH.test(value) ? value : null;
  if (/%[0-9a-f]{2}/i.test(value) && /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)/i.test(value)) return null;
  if (/%(?![0-9a-f]{2})/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Parse a stored or public payload, falling back to the safe defaults. */
export function headerSettingsFrom(value: unknown): SiteHeaderSettings {
  const result = defaultSiteHeader();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const row = value as Record<string, unknown>;
  const brand = safeHeaderHref(row.brand_href);
  if (brand) result.brand_href = brand;
  for (const key of ["search_enabled", "sticky", "language_switcher"] as const) {
    if (typeof row[key] === "boolean") result[key] = row[key];
  }
  if (typeof row.cta_label === "string" && row.cta_label.length <= 120) {
    result.cta_label = row.cta_label;
  }
  result.cta_url = safeHeaderHref(row.cta_url) ?? "";
  if (!result.cta_url) result.cta_label = "";
  return result;
}
