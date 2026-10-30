/** Build a Page URL for exactly one Site. The id is never taken from a request body. */
export function sitePagePath(siteId: number, suffix = ""): string {
  if (!Number.isInteger(siteId) || siteId < 1) {
    throw new Error("A page request needs one Site id.");
  }
  const tail = suffix.replace(/^\/+/, "");
  return tail ? `/v1/sites/${siteId}/pages/${tail}` : `/v1/sites/${siteId}/pages/`;
}
