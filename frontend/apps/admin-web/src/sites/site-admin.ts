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
  key: "dashboard" | "pages" | "posts" | "menus";
  label: string;
  segment: "" | "pages" | "posts" | "menus";
  module: "PAGES" | "POSTS" | "MENUS" | null;
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

export function sectionByKey(key: SiteSection["key"]): SiteSection {
  const section = SITE_SECTIONS.find((item) => item.key === key);
  if (!section) throw new Error("Unknown site section.");
  return section;
}

/** Pages, Posts and Menus need both an enabled Site module and a permission. */
export function sectionDecision(section: SiteSection, access: SiteAccessInput): SectionDecision {
  if (section.module == null) return "visible";
  if (!access.enabledModuleCodes.includes(section.module)) return "module_disabled";
  if (!section.permissions.some((code) => access.permissions.includes(code))) {
    return "permission_denied";
  }
  return "visible";
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

/** Switching Sites always opens that Site's dashboard so forms are not carried over. */
export function siteSwitchHref(siteId: number): string {
  return siteAdminHref(siteId);
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
  rows: readonly { site: number; is_enabled: boolean; module_code?: string }[],
  siteId: number,
): string[] {
  return rows
    .filter((row) => row.site === siteId && row.is_enabled && typeof row.module_code === "string" && row.module_code.length > 0)
    .map((row) => row.module_code as string);
}

export function canActivateCentralModules(permissions: readonly string[]): boolean {
  return permissions.includes(CENTRAL_MODULE_PERMISSION);
}
