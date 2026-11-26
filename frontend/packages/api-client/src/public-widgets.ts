export interface SiteWidgetEnvelope {
  site: number;
  source: string;
  results: Record<string, unknown>[];
}

export class SiteWidgetRequestError extends Error {
  constructor(readonly kind: "transport" | "unavailable" | "invalid_response") {
    super(kind);
    this.name = "SiteWidgetRequestError";
  }
}

/** Contract adapter for public and private-preview Site widget data. */
export async function fetchSiteWidgetData(
  fetchFn: typeof fetch,
  endpoint: string,
  query: Record<string, string>,
  expectedSite: number,
  signal?: AbortSignal,
): Promise<SiteWidgetEnvelope> {
  const params = new URLSearchParams(query);
  let response: Response;
  try {
    response = await fetchFn(`${endpoint}?${params}`, {
      cache: "no-store", signal, headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SiteWidgetRequestError("transport");
  }
  if (!response.ok) throw new SiteWidgetRequestError(response.status === 404 ? "unavailable" : "transport");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new SiteWidgetRequestError("invalid_response"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SiteWidgetRequestError("invalid_response");
  const envelope = payload as Partial<SiteWidgetEnvelope>;
  if (envelope.site !== expectedSite || (envelope.source !== undefined && envelope.source !== query.source) || !Array.isArray(envelope.results)
      || envelope.results.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new SiteWidgetRequestError("invalid_response");
  }
  return envelope as SiteWidgetEnvelope;
}
