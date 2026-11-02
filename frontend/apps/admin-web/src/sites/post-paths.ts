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

const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared content workflow route. The Post id is the content id, still scoped to one Site. */
export function sitePostWorkflowPath(siteId: number, postId: string): string {
  sitePath(siteId, "posts");
  if (!POST_ID.test(postId)) {
    throw new Error("A Post workflow request needs the Post id.");
  }
  return `/v1/cms/sites/${siteId}/content/${postId}/workflow/`;
}

export function sitePostWorkflowHistoryPath(siteId: number, postId: string): string {
  return sitePostWorkflowPath(siteId, postId).replace(/workflow\/$/, "workflow-history/");
}
