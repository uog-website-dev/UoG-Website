import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/sites/11/admin/staff-directory/settings",
}));

vi.mock("@/sites/site-admin-frame", () => ({
  useSiteAdmin: () => ({
    site: { id: 11, name: "Informatics" },
    enabledModuleCodes: ["STAFF_DIRECTORY"],
    permissions: ["sites.update"],
  }),
}));

import { SiteStaffDirectoryNav } from "./site-staff-directory-nav";
import { sectionDecision, sectionByKey, visibleSiteSections } from "./site-admin";

describe("Staff Directory navigation", () => {
  it("exposes All Staff, Add New and Directory Settings links", () => {
    render(
      <SiteStaffDirectoryNav title="Directory Settings" description="Configure Staff Directory for Informatics." />,
    );
    expect(screen.getByRole("navigation", { name: "Staff Directory" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All Staff" }).getAttribute("href")).toBe(
      "/sites/11/admin/staff-directory",
    );
    expect(screen.getByRole("link", { name: "Add New" }).getAttribute("href")).toBe(
      "/sites/11/admin/staff-directory/new",
    );
    expect(screen.getByRole("link", { name: "Directory Settings" }).getAttribute("href")).toBe(
      "/sites/11/admin/staff-directory/settings",
    );
  });

  it("shows Staff Directory in the Site sidebar only when STAFF_DIRECTORY is enabled for a Site Admin", () => {
    expect(sectionDecision(sectionByKey("staff-directory"), {
      enabledModuleCodes: ["STAFF_DIRECTORY"],
      permissions: ["sites.update"],
    })).toBe("visible");
    expect(visibleSiteSections({
      enabledModuleCodes: ["PAGES"],
      permissions: ["sites.update"],
    }).map((section) => section.key)).not.toContain("staff-directory");
    expect(visibleSiteSections({
      enabledModuleCodes: ["STAFF_DIRECTORY"],
      permissions: ["sites.update"],
    }).map((section) => section.key)).toContain("staff-directory");
  });
});
