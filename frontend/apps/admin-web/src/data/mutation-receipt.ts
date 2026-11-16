import type {ActionResult} from "@/organizations/contract";

/** Server-confirmed invalidation hint, not an authorization grant or optimistic data. */
export async function invalidated<T>(site: number, domain: "pages" | "posts" | "menus" | "media", result: Promise<ActionResult<T>>, workspace = false): Promise<ActionResult<T>> {
  const outcome = await result;
  if (outcome.ok) return {...outcome, invalidation: {site, domain, workspace}};
  return [401, 403].includes(outcome.error.status) ? {...outcome, deniedSite: site} : outcome;
}
