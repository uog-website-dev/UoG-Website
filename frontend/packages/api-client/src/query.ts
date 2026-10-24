/**
 * Query-string helpers for the discovery endpoints.
 *
 * The organization list rejects unknown, repeated or invalid query
 * parameters with 400 (see backend/apps/organizations/api/discovery.py), so
 * this builder only emits values that are present and meaningful: `undefined`,
 * `null` and the empty string are dropped instead of being sent as blank
 * filters, which the backend would otherwise treat as a real (and rejected)
 * filter value.
 */

/** A single query parameter value that can be dropped when empty. */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * Build a `?a=1&b=2` string from a partial record.
 *
 * Values that are `undefined`, `null` or an empty string are omitted.
 * Numbers and booleans are stringified. Keys are emitted in the order given.
 * The result never starts with `?` and is empty when nothing is set, so it
 * can be concatenated directly onto a path.
 */
export function buildQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = typeof value === "string" ? value.trim() : String(value);
    if (text === "") continue;
    search.append(key, text);
  }
  return search.toString();
}

/**
 * Append a query string to a path, handling a path that may or may not end
 * with `/` and an existing query string.
 */
export function withQuery(path: string, query: string): string {
  if (!query) return path;
  return path.includes("?") ? `${path}&${query}` : `${path}?${query}`;
}
