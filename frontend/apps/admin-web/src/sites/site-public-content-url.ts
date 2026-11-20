import type { SiteAdminSite } from "./site-admin-frame";

/** Build a public URL only from this active Site's configured primary host and route. */
export function sitePublicContentUrl(site: SiteAdminSite | null, route: string | null | undefined): string | null {
  if (!site || site.status !== "ACTIVE" || !site.primaryDomain || site.primaryDomain.status !== "ACTIVE") return null;
  const host = site.primaryDomain.hostname.toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return null;
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || /[\\\u0000-\u0020]/.test(route)) return null;
  const protocol = host.endsWith(".uog.local") ? "http:" : "https:";
  return new URL(route, `${protocol}//${host}`).toString();
}
