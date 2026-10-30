/** Build a menu URL for exactly one Site. The id is never taken from a request body. */
export function siteMenuPath(siteId: number, suffix = ""): string {
  if (!Number.isInteger(siteId) || siteId < 1) {
    throw new Error("A menu request needs one Site id.");
  }
  return `/v1/sites/${siteId}/menus/${suffix}`;
}
