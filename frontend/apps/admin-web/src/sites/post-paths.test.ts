import { describe, expect, it } from "vitest";

import { siteCategoriesPath, sitePostWorkflowPath, sitePostsPath, siteTagsPath } from "./post-paths";

describe("Site Post API paths", () => {
  it("keeps every collection and detail scoped to its Site", () => {
    expect(sitePostsPath(11)).toBe("/v1/sites/11/posts/");
    expect(sitePostsPath(11, "post-1/")).toBe("/v1/sites/11/posts/post-1/");
    expect(siteCategoriesPath(22)).toBe("/v1/sites/22/categories/");
    expect(siteTagsPath(22, "tag-1/")).toBe("/v1/sites/22/tags/tag-1/");
  });

  it("rejects invalid Site ids", () => {
    expect(() => sitePostsPath(0)).toThrow(/one Site id/);
    expect(() => siteCategoriesPath(1.5)).toThrow(/one Site id/);
  });

  it("builds the shared workflow route from the Site and Post id", () => {
    const postId = "11111111-1111-1111-1111-111111111111";
    expect(sitePostWorkflowPath(11, postId)).toBe(`/v1/cms/sites/11/content/${postId}/workflow/`);
    expect(() => sitePostWorkflowPath(11, "../other")).toThrow(/Post id/);
  });
});
