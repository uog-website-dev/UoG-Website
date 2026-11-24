import { hasPlatformWorkspace } from "@/navigation";

/** Return the only authorized Site for a Site-only account, if there is one. */
export function singleAuthorizedSiteId(
  platformPermissions: readonly string[],
  discovery: unknown,
): number | null {
  if (hasPlatformWorkspace(platformPermissions) || !discovery || typeof discovery !== "object") return null;
  const result = discovery as { count?: unknown; results?: unknown };
  if (result.count !== 1 || !Array.isArray(result.results) || result.results.length !== 1) return null;
  const site: unknown = result.results[0];
  if (!site || typeof site !== "object" || Array.isArray(site)) return null;
  const id = (site as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
