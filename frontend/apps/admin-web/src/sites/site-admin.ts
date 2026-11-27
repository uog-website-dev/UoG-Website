/**
 * Site administration inside the shared admin console.
 *
 * One application serves every Site. A section is shown only when that
 * Site has the module enabled and the signed-in user holds one of the
 * section's permissions. Central module activation is a separate
 * platform permission and is not part of this menu.
 */

export const CENTRAL_MODULE_PERMISSION = "platform.sites.manage_registry";

export interface SiteSection {
  key: "header" | "footer" | "appearance" | "dashboard" | "sidebars" | "pages" | "builder" | "homepage" | "posts" | "documents" | "events" | "menus" | "media" | "users";
  label: string;
  segment: "header" | "footer" | "appearance" | "" | "sidebars" | "pages" | "builder" | "homepage" | "posts" | "documents" | "events" | "menus" | "media" | "users";
  module: "PAGES" | "POSTS" | "DOCUMENTS" | "EVENTS" | "MENUS" | "MEDIA" | "VISUAL_BUILDER" | null;
  /** Any one enabled module satisfies the gate; used when two modules qualify. */
  modules?: readonly ("PAGES" | "POSTS" | "DOCUMENTS" | "EVENTS" | "MENUS" | "MEDIA" | "VISUAL_BUILDER")[];
  permissions: readonly string[];
}

export const SITE_SECTIONS: readonly SiteSection[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    segment: "",
    module: null,
    permissions: [],
  },
  {
    key: "pages",
    label: "Pages",
    segment: "pages",
    module: "PAGES",
    permissions: [
      "content.pages.view",
      "content.pages.create",
      "content.pages.update",
      "content.pages.publish",
    ],
  },
  { key: "sidebars", label: "Sidebars", segment: "sidebars", module: "PAGES", permissions: ["content.pages.update"] },
  {
    key: "builder",
    label: "Visual Builder",
    segment: "builder",
    module: "VISUAL_BUILDER",
    permissions: ["content.pages.update"],
  },
  {
    key: "homepage",
    label: "Homepage Settings",
    segment: "homepage",
    module: "PAGES",
    permissions: ["sites.update"],
  },
  {key:"header",label:"Header",segment:"header",module:null,modules:["MENUS","PAGES"],permissions:["sites.update"]},
  {key:"footer",label:"Footer",segment:"footer",module:null,permissions:["sites.update"]},
  {key: "appearance", label: "Appearance", segment: "appearance", module: null, permissions: ["sites.update"]},
  {
    key: "posts",
    label: "Posts",
    segment: "posts",
    module: "POSTS",
    permissions: [
      "content.posts.view",
      "content.posts.create",
      "content.posts.update",
      "content.posts.publish",
    ],
  },
  { key: "documents", label: "Documents", segment: "documents", module: "DOCUMENTS", permissions: ["content.documents.view", "content.documents.create", "content.documents.update", "content.documents.publish"] },
  { key: "events", label: "Events", segment: "events", module: "EVENTS", permissions: ["sites.update"] },
  { key: "media", label: "Media", segment: "media", module: "MEDIA", permissions: ["content.media.view"] },
  {
    key: "users",
    label: "Users",
    segment: "users",
    module: null,
    permissions: ["platform.users.view"],
  },
  {
    key: "menus",
    label: "Menus",
    segment: "menus",
    module: "MENUS",
    permissions: ["menu.read", "menu.write", "menu.publish"],
  },
];

export type SectionDecision = "visible" | "module_disabled" | "permission_denied";

export interface SiteAccessInput {
  enabledModuleCodes: readonly string[];
  permissions: readonly string[];
}

export function findSiteSection(key: string): SiteSection | null {
  return SITE_SECTIONS.find((item) => item.key === key) ?? null;
}

export function sectionByKey(key: SiteSection["key"] | string): SiteSection {
  const section = findSiteSection(key);
  if (!section) throw new Error(`Unknown site section: ${key}`);
  return section;
}

/** Pages, Posts and Menus need both an enabled Site module and a permission. */
export function sectionDecision(section: SiteSection, access: SiteAccessInput): SectionDecision {
  if (section.key === "dashboard") return "visible";
  const requiredModules = section.modules ?? (section.module ? [section.module] : []);
  if (requiredModules.length > 0 && !requiredModules.some((code) => access.enabledModuleCodes.includes(code))) {
    return "module_disabled";
  }
  return section.permissions.some((code) => access.permissions.includes(code))
    ? "visible"
    : "permission_denied";
}

export function visibleSiteSections(access: SiteAccessInput): SiteSection[] {
  return SITE_SECTIONS.filter((section) => sectionDecision(section, access) === "visible");
}

export function siteAdminHref(siteId: number, segment: SiteSection["segment"] = ""): string {
  if (!Number.isInteger(siteId) || siteId < 1) {
    throw new Error("A site administration link needs one Site id.");
  }
  return segment ? `/sites/${siteId}/admin/${segment}` : `/sites/${siteId}/admin`;
}

export function isSiteSectionActive(section:SiteSection,siteId:number,path:string):boolean {
  const canvas=path.startsWith(`${siteAdminHref(siteId,"pages")}/`) && path.endsWith("/builder");
  if(canvas)return section.key==="builder";
  const href=siteAdminHref(siteId,section.segment);
  return path===href || Boolean(section.segment && path.startsWith(`${href}/`));
}

/** In-section Events links: All Events, Add New Event, Event Settings. */
export const EVENT_NAV_ITEMS = [
  { key: "all", label: "All Events", suffix: "" },
  { key: "new", label: "Add New Event", suffix: "/new" },
  { key: "settings", label: "Event Settings", suffix: "/settings" },
] as const;

export function eventAdminHref(siteId: number, suffix: "" | "/new" | "/settings" = ""): string {
  return `${siteAdminHref(siteId, "events")}${suffix}`;
}

/** Preserve only a section, never another Site's object ID, query or draft. */
export function siteSwitchHref(siteId: number, path = "", access?: SiteAccessInput): string {
  const source = /^\/sites\/[1-9]\d*\/admin(?:\/([^/?#]+))?/.exec(path);
  const section = SITE_SECTIONS.find(item => item.segment === (source?.[1] ?? ""));
  if (!section) return siteAdminHref(siteId);
  // A Page-specific visual canvas returns to the Builder directory, not Pages.
  const canvas = source?.[1] === "pages" && /\/pages\/[^/]+\/builder\/?$/.test(path);
  const destination = canvas ? sectionByKey("builder") : section;
  return access && sectionDecision(destination, access) !== "visible" ? siteAdminHref(siteId) : siteAdminHref(siteId, destination.segment);
}

export function accessibleSiteOptions<T extends { id: number }>(sites: readonly T[]): T[] {
  const seen = new Set<number>();
  const choices: T[] = [];
  for (const site of sites) {
    if (!Number.isInteger(site.id) || site.id < 1 || seen.has(site.id)) continue;
    seen.add(site.id);
    choices.push(site);
  }
  return choices;
}

export function enabledModuleCodes(
  rows: readonly { site: number; is_enabled: boolean; is_available?: boolean; module_code?: string }[],
  siteId: number,
): string[] {
  return rows
    .filter((row) => row.site === siteId && row.is_enabled && row.is_available !== false && typeof row.module_code === "string" && row.module_code.length > 0)
    .map((row) => row.module_code as string);
}

export function canActivateCentralModules(permissions: readonly string[]): boolean {
  return permissions.includes(CENTRAL_MODULE_PERMISSION);
}
