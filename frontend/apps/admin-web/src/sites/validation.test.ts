import { describe, expect, it } from "vitest";
import type { Site } from "@uog/types";
import { defaultSiteConfiguration } from "@uog/api-client";
import { buildConfigurationChanges, formValuesFromSite } from "./validation";

const logo = "a09a4b48-3343-4e6b-9baa-61db3f726003";

function site(configuration = defaultSiteConfiguration("en-us")): Site {
  return {
    id: 7, code: "INFORMATICS", name: "College of Informatics", short_name: "CI",
    organization_unit: 3, default_language: "en-us", status: "ACTIVE", is_main: false,
    template: null, configuration, homepage: null, created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("Site appearance configuration", () => {
  it("reopens a logo reference and saves the same compact Site-owned asset identity", () => {
    const current = defaultSiteConfiguration("en-us");
    current.identity.logo_ref = logo;
    const values = formValuesFromSite(site(current));
    expect(values.logo_asset_id).toBe(logo);
    expect(buildConfigurationChanges(values).identity?.logo_ref).toBe(logo.replaceAll("-", ""));
  });

  it("sends only an approved theme token and has no custom color or CSS fields", () => {
    const values = formValuesFromSite(site());
    values.theme = "high-contrast";
    const changes = buildConfigurationChanges(values);
    expect(changes.presentation).toEqual({ theme: "high-contrast" });
    expect(changes.presentation).not.toHaveProperty("custom_css");
    expect(changes.presentation).not.toHaveProperty("primary_color");
  });
});
