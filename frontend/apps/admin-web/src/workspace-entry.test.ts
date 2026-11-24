import { describe, expect, it } from "vitest";
import { singleAuthorizedSiteId } from "@/workspace-entry";

describe("single authorized Site entry", () => {
  it("returns the only Site for a Site-only account", () => {
    expect(singleAuthorizedSiteId([], { count: 1, results: [{ id: 102, name: "AAU Builder Comparison" }] })).toBe(102);
  });

  it("keeps platform administrators on the platform dashboard", () => {
    expect(singleAuthorizedSiteId(["platform.organizations.view"], { count: 1, results: [{ id: 102 }] })).toBeNull();
  });

  it("does not choose when there are zero, multiple, or invalid Site results", () => {
    expect(singleAuthorizedSiteId([], { count: 0, results: [] })).toBeNull();
    expect(singleAuthorizedSiteId([], { count: 2, results: [{ id: 102 }, { id: 103 }] })).toBeNull();
    expect(singleAuthorizedSiteId([], { count: 1, results: [{ id: "102" }] })).toBeNull();
    expect(singleAuthorizedSiteId([], { count: 1, results: [0] })).toBeNull();
  });
});
