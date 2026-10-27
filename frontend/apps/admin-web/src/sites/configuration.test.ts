import { describe, expect, it } from "vitest";

import type { Site, SiteConfiguration } from "@uog/types";
import { defaultSiteConfiguration } from "@uog/api-client";

import { baselineFor, configurationRows, originCaption } from "./configuration";

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 1,
    code: "COI_PORTAL",
    name: "College of Informatics",
    short_name: "",
    organization_unit: 2,
    default_language: "en",
    status: "ACTIVE",
    is_main: false,
    template: 1,
    configuration: defaultSiteConfiguration("en"),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("configurationRows — provenance", () => {
  it("marks values equal to the template defaults as inherited", () => {
    const baseline = defaultSiteConfiguration("en");
    const rows = configurationRows(site(), baseline);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

    expect(byKey.display_name.origin).toBe("inherited");
    expect(byKey.theme.origin).toBe("inherited");
    expect(byKey.show_search.origin).toBe("inherited");
    expect(byKey.enabled_languages.origin).toBe("inherited");
  });

  it("marks values that differ from the template defaults as overrides", () => {
    const baseline = defaultSiteConfiguration("en");
    const current = site();
    current.configuration = {
      ...current.configuration,
      identity: {
        ...current.configuration.identity,
        display_name: "College of Informatics",
      },
      language: { enabled: ["en", "am"] },
      behavior: { show_search: true, show_language_switcher: false },
    };

    const byKey = Object.fromEntries(
      configurationRows(current, baseline).map((row) => [row.key, row]),
    );

    expect(byKey.display_name.origin).toBe("override");
    expect(byKey.display_name.value).toBe("College of Informatics");
    expect(byKey.enabled_languages.origin).toBe("override");
    expect(byKey.enabled_languages.value).toBe("en, am");
    expect(byKey.show_search.origin).toBe("override");
    // Theme was untouched, so it stays inherited even beside overrides.
    expect(byKey.theme.origin).toBe("inherited");
  });

  it("treats the default language as the site's own value, not provenance", () => {
    const rows = configurationRows(site(), defaultSiteConfiguration("en"));
    const row = rows.find((entry) => entry.key === "default_language");
    expect(row?.origin).toBe("override");
    expect(row?.value).toBe("en");
  });

  it("falls back to schema defaults when the site has no template", () => {
    const current = site({ template: null });
    const baseline = baselineFor(current, null);

    expect(baseline).toEqual(defaultSiteConfiguration("en"));

    const byKey = Object.fromEntries(
      configurationRows(current, baseline).map((row) => [row.key, row]),
    );
    expect(byKey.theme.origin).toBe("inherited");
  });

  it("describes each origin in plain language", () => {
    expect(originCaption("inherited", "template INSTITUTIONAL")).toBe(
      "Inherited from template INSTITUTIONAL",
    );
    expect(originCaption("override", "the platform defaults")).toBe(
      "Override of the platform defaults",
    );
  });
});

describe("configuration documents", () => {
  it("produces a schema-version-1 document for a given language", () => {
    const document: SiteConfiguration = defaultSiteConfiguration("am");
    expect(document.schema_version).toBe(1);
    expect(document.language.enabled).toEqual(["am"]);
    expect(document.presentation.theme).toBe("institutional");
    expect(document.behavior).toEqual({
      show_search: false,
      show_language_switcher: false,
    });
  });
});
