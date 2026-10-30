import { describe, expect, it } from "vitest";

import { sitePagePath } from "./page-paths";

describe("sitePagePath", () => {
  it("builds list, detail, workflow and homepage URLs for one Site", () => {
    expect(sitePagePath(11)).toBe("/v1/sites/11/pages/");
    expect(sitePagePath(11, "abc/")).toBe("/v1/sites/11/pages/abc/");
    expect(sitePagePath(11, "abc/workflow/")).toBe("/v1/sites/11/pages/abc/workflow/");
    expect(sitePagePath(11, "abc/homepage/")).toBe("/v1/sites/11/pages/abc/homepage/");
  });

  it("rejects a missing Site id", () => {
    expect(() => sitePagePath(0)).toThrow(/one Site id/);
    expect(() => sitePagePath(1.5)).toThrow(/one Site id/);
  });
});
