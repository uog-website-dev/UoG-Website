/** Build authoring routes scoped to one Site. Never accept Site identity from a body. */
function sitePath(siteId: number, collection: "posts" | "categories" | "tags", suffix = ""): string {
  if (!Number.isInteger(siteId) || siteId < 1) {
    throw new Error("A Site Post request needs one Site id.");
  }
  const tail = suffix.replace(/^\/+/, "");
  const base = `/v1/sites/${siteId}/${collection}/`;
  return tail ? `${base}${tail}` : base;
}

export function sitePostsPath(siteId: number, suffix = ""): string {
  return sitePath(siteId, "posts", suffix);
}

export function siteCategoriesPath(siteId: number, suffix = ""): string {
  return sitePath(siteId, "categories", suffix);
}

export function siteTagsPath(siteId: number, suffix = ""): string {
  return sitePath(siteId, "tags", suffix);
}
