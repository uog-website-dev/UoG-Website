import { describe, expect, it } from "vitest";

import {
  adminNavItems,
  hasPlatformWorkspace,
  isNavItemActive,
  normalizeAdminPathname,
  siteWorkspaceId,
  visiblePlatformNavItems,
} from "@/navigation";
import { workspaceHref, workspaceValue } from "@/workspace";

describe("platform workspace visibility", () => {
  it("gates every platform entry on a platform-scoped permission", () => {
    expect(adminNavItems.every((item) => (item.requiresAny ?? []).length > 0)).toBe(true);
    expect(visiblePlatformNavItems([])).toEqual([]);
    expect(hasPlatformWorkspace([])).toBe(false);
  });

  it("shows only the entries a platform permission covers", () => {
    const keys = visiblePlatformNavItems(["platform.organizations.view"]).map((item) => item.key);
    expect(keys).toEqual(["organizations"]);
    expect(hasPlatformWorkspace(["platform.organizations.view"])).toBe(true);
  });

  it("ignores content permissions that do not open a platform screen", () => {
    expect(hasPlatformWorkspace(["content.pages.view", "menu.read"])).toBe(false);
  });
});

describe("workspace paths", () => {
  it("finds the Site workspace from a Site administration path only", () => {
    expect(siteWorkspaceId("/sites/2/admin")).toBe(2);
    expect(siteWorkspaceId("/sites/2/admin/pages")).toBe(2);
    expect(siteWorkspaceId("/sites/2")).toBeNull();
    expect(siteWorkspaceId("/sites/0/admin")).toBeNull();
    expect(siteWorkspaceId("/sites/2/administer")).toBeNull();
  });

  it("maps selector values to their dashboards", () => {
    expect(workspaceValue(null)).toBe("platform");
    expect(workspaceValue(7)).toBe("site:7");
    expect(workspaceHref("platform")).toBe("/");
    expect(workspaceHref("site:7")).toBe("/sites/7/admin");
    expect(workspaceHref("site:abc")).toBeNull();
  });
});

describe("adminNavItems", () => {
  it("exposes the Organizations, Sites, Domains, Modules and permission-gated Access control entries", () => {
    const hrefs = adminNavItems.map((item) => item.href);
    expect(hrefs).toEqual([
      "/",
      "/organizations",
      "/sites",
      "/domains",
      "/modules",
      "/access",
    ]);
    expect(adminNavItems.at(-1)?.requiresAny).toContain("platform.roles.view");
    expect(adminNavItems.find((item) => item.key === "modules")?.requiresAny).toEqual([
      "platform.sites.manage_registry",
    ]);
  });

  it("labels every entry for the navigation list", () => {
    for (const item of adminNavItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      // MUI icons are forwardRef components (objects), not plain functions.
      expect(item.icon).toBeTruthy();
    }
  });
});

describe("normalizeAdminPathname", () => {
  it("maps empty input to the dashboard root", () => {
    expect(normalizeAdminPathname(null)).toBe("/");
    expect(normalizeAdminPathname("")).toBe("/");
  });

  it("keeps app-relative paths untouched", () => {
    expect(normalizeAdminPathname("/")).toBe("/");
    expect(normalizeAdminPathname("/organizations")).toBe("/organizations");
    expect(normalizeAdminPathname("/sites")).toBe("/sites");
  });

  it("strips the Next.js base path when present", () => {
    expect(normalizeAdminPathname("/admin")).toBe("/");
    expect(normalizeAdminPathname("/admin/organizations")).toBe("/organizations");
    expect(normalizeAdminPathname("/admin/sites/")).toBe("/sites");
  });
});

describe("isNavItemActive", () => {
  const dashboard = adminNavItems[0];
  const organizations = adminNavItems[1];
  const sites = adminNavItems[2];

  it("matches the dashboard only on the root path", () => {
    expect(isNavItemActive(dashboard, "/")).toBe(true);
    expect(isNavItemActive(dashboard, "/organizations")).toBe(false);
  });

  it("matches a section on its own path and nested paths", () => {
    expect(isNavItemActive(organizations, "/organizations")).toBe(true);
    expect(isNavItemActive(sites, "/sites")).toBe(true);
  });

  it("does not cross-match sibling sections", () => {
    expect(isNavItemActive(sites, "/organizations")).toBe(false);
    expect(isNavItemActive(organizations, "/sites")).toBe(false);
  });
});
