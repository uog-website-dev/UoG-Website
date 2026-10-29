import { describe, expect, it } from "vitest";

import {
  adminNavItems,
  isNavItemActive,
  normalizeAdminPathname,
} from "@/navigation";

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
