/**
 * Host-resolved public Site decisions.
 *
 * The browser never chooses a Site id. These helpers only interpret the
 * payload from `GET /api/v1/site-context/` and the public page, post and
 * menu routes. A missing module, a draft, or another Site's id becomes
 * an empty result.
 */

export const PUBLIC_CACHE_MODE = "no-store" as const;

/** Matches the public API Cache-Control. max-age=0 means the next read revalidates. */
export const PUBLIC_CACHE_SLA = "public, max-age=0, must-revalidate";

export function publicFetchInit(): RequestInit {
  return {
    headers: { Accept: "application/json" },
    cache: PUBLIC_CACHE_MODE,
    redirect: "manual",
  };
}

export interface PublicSiteContext {
  id: number | null;
  code: string | null;
  name: string;
  displayName: string;
  theme: "institutional" | "high-contrast";
  modules: { pages: boolean; posts: boolean; menus: boolean };
}

export const EMPTY_SITE: PublicSiteContext = {
  id: null,
  code: null,
  name: "",
  displayName: "University of Gondar",
  theme: "institutional",
  modules: { pages: false, posts: false, menus: false },
};

export function siteFromContext(status: number, body: unknown): PublicSiteContext {
  if (status !== 200 || body == null || typeof body !== "object" || Array.isArray(body)) {
    return EMPTY_SITE;
  }
  const row = body as {
    site?: { id?: unknown; code?: unknown; name?: unknown } | null;
    configuration?: { display_name?: unknown; theme?: unknown } | null;
    modules?: unknown;
  };
  const site = row.site;
  if (site == null) return EMPTY_SITE;
  if (typeof site.id !== "number" || typeof site.name !== "string" || !site.name.trim()) {
    return EMPTY_SITE;
  }
  const modules = Array.isArray(row.modules)
    ? row.modules.filter((code): code is string => typeof code === "string")
    : [];
  const display = row.configuration?.display_name;
  const theme = row.configuration?.theme === "high-contrast" ? "high-contrast" : "institutional";
  return {
    id: site.id,
    code: typeof site.code === "string" ? site.code : null,
    name: site.name.trim(),
    displayName: typeof display === "string" && display.trim() ? display.trim() : site.name.trim(),
    theme,
    modules: {
      pages: modules.includes("PAGES"),
      posts: modules.includes("POSTS"),
      menus: modules.includes("MENUS"),
    },
  };
}

/** A public document may be shown only when it belongs to the resolved Site. */
export function sameSite(documentSite: number | null, siteId: number | null): boolean {
  if (siteId == null || documentSite == null) return false;
  return documentSite === siteId;
}

export function safePagePath(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > 8) return null;
  if (segments.some((segment) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment))) return null;
  return `/${segments.join("/")}`;
}

/**
 * Turn a public page redirect into a path on this website.
 * Absolute URLs and locations outside the page API are rejected.
 */
export function websitePathFromRedirect(location: string | null): string | null {
  if (!location || /[\u0000-\u0020\\]/.test(location)) return null;
  let path = location;
  if (location.startsWith("http://") || location.startsWith("https://")) {
    try {
      path = `${new URL(location).pathname}${new URL(location).search}`;
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/api/v1/site-context/pages")) return null;
  const rest = path.slice("/api/v1/site-context/pages".length);
  const pathname = rest.split("?")[0] || "/";
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return safePagePath(segments);
}

export function pageMetadata(
  site: PublicSiteContext,
  page: { title: string; seo: { title: string; description: string } } | null,
): { title: string; description: string } {
  const title = page?.seo.title || page?.title || site.displayName;
  const description = page?.seo.description || site.displayName;
  return { title, description };
}

/** Document title and description for a published Post detail page. */
export function postMetadata(
  site: PublicSiteContext,
  post: { title: string; excerpt?: string; seo: { title: string; description: string } } | null,
): { title: string; description: string } {
  const title = post?.seo.title || post?.title || site.displayName;
  const description = post?.seo.description || post?.excerpt?.trim() || site.displayName;
  return { title, description };
}
