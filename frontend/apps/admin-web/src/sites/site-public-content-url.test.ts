import { describe, expect, it } from "vitest";

import { sitePublicContentUrl } from "./site-public-content-url";
import type { SiteAdminSite } from "./site-admin-frame";

const activeSite: SiteAdminSite = {
  id: 11, name: "Informatics", code: "INFO", status: "ACTIVE",
  primaryDomain: { hostname: "informatics.uog.edu.et", status: "ACTIVE" },
};

describe("sitePublicContentUrl", () => {
  it("combines the configured Site hostname with the published route", () => {
    expect(sitePublicContentUrl(activeSite, "/news/campus-update")).toBe("https://informatics.uog.edu.et/news/campus-update");
  });

  it("uses local HTTP and refuses unpublished, inactive, foreign or unsafe targets", () => {
    expect(sitePublicContentUrl({ ...activeSite, primaryDomain: { hostname: "info.uog.local", status: "ACTIVE" } }, "/about")).toBe("http://info.uog.local/about");
    expect(sitePublicContentUrl({ ...activeSite, status: "SUSPENDED" }, "/about")).toBeNull();
    expect(sitePublicContentUrl({ ...activeSite, primaryDomain: { hostname: "private.uog.edu.et", status: "INACTIVE" } }, "/about")).toBeNull();
    expect(sitePublicContentUrl(activeSite, "https://foreign.example/page")).toBeNull();
    expect(sitePublicContentUrl(activeSite, "//foreign.example/page")).toBeNull();
  });
});
