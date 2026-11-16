import { getAccessToken } from "@/access-token";
import { serverApiFetch } from "@/performance/server-fetch";
import {getCacheIdentity} from "@/cache-identity";

/** One upstream request; credentials never cross into the client response. */
export async function workspaceProxy(request: Request, discovery = false) {
  const headers = {"Cache-Control": "private, no-store", Vary: "Cookie"};
  const query = new URL(request.url).searchParams;
  const allowed = discovery ? ["search", "page", "page_size"] : ["site"];
  if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)
      || (!discovery && query.has("site") && (!/^[1-9]\d*$/.test(query.get("site")!) || !Number.isSafeInteger(Number(query.get("site")))))) {
    return Response.json({error: "invalid_query"}, {status: 400, headers});
  }
  const token = await getAccessToken();
  const cacheIdentity = token ? await getCacheIdentity() : null;
  if (!token || !cacheIdentity) return Response.json({error: "unauthenticated"}, {status: 401, headers});
  try {
    const response = await serverApiFetch(`${process.env.API_BASE_URL ?? "http://backend:8000/api"}/workspace/${discovery ? "sites/" : ""}?${query}`, {
      headers: {Authorization: `Bearer ${token}`}, cache: "no-store", signal: request.signal,
    });
    const body = await response.json();
    if (!discovery && response.ok) body.cacheIdentity = cacheIdentity;
    return Response.json(body, {status: response.status, headers: {...headers, ...(response.headers.get("ETag") ? {ETag: response.headers.get("ETag")!} : {})}});
  } catch {
    return Response.json({error: "workspace_unavailable"}, {status: 502, headers});
  }
}
