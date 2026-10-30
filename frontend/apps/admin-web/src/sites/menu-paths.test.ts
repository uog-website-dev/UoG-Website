import { describe, expect, it } from "vitest";

import { siteMenuPath } from "./menu-paths";

describe("siteMenuPath", () => {
  it("scopes every menu route to the Site id it was given", () => {
    expect(siteMenuPath(11)).toBe("/v1/sites/11/menus/");
    expect(siteMenuPath(11, "abc/reorder/")).toBe("/v1/sites/11/menus/abc/reorder/");
    expect(siteMenuPath(11)).not.toContain("/sites/22/");
  });

  it("rejects a missing or foreign-looking id", () => {
    expect(() => siteMenuPath(0)).toThrow(/Site id/);
    expect(() => siteMenuPath(1.5)).toThrow(/Site id/);
  });
});
