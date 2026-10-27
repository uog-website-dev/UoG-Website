/**
 * URL query-state contract for the site list screen.
 *
 * The list's applied filters, page and sort live in the URL query string so a
 * view can be shared, bookmarked and reloaded without losing state. This
 * module is the single place that:
 *
 *   - parses a URL into a `SiteListQuery`, defensively: the URL is untrusted
 *     input, and the backend answers 400 for unknown, repeated or invalid
 *     parameters, so anything that does not match the documented contract
 *     (backend/apps/sites/api/query.py) is dropped rather than forwarded;
 *   - serializes state back into query parameters, omitting defaults so URLs
 *     stay clean;
 *   - maps the table's `SortState` to and from the backend's `ordering`
 *     parameter (code, name, status, created_at, updated_at; '-' descending).
 */
import type { SiteListQuery, SiteStatus } from "@uog/types";
import type { SortState } from "@uog/ui";

/** Ordering fields the backend's SiteQuerySerializer accepts. */
export const SITE_ORDERING_FIELDS = [
  "code",
  "name",
  "status",
  "created_at",
  "updated_at",
] as const;

/** Default ordering of the backend: code ascending. */
export const DEFAULT_SORT: SortState = { field: "code", direction: "asc" };

/** Lifecycle statuses the backend's status filter accepts. */
const STATUSES: readonly SiteStatus[] = [
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "ARCHIVED",
];

/** Raw filter draft values; `""` means "no filter". */
export interface SiteListDraft {
  search: string;
  code: string;
  status: string;
  /** `""` all, decimal string otherwise. */
  organization_unit: string;
}

export function emptyDraft(): SiteListDraft {
  return { search: "", code: "", status: "", organization_unit: "" };
}

/** Minimal read-only view of a query string (URLSearchParams-compatible). */
export interface QueryReader {
  get(name: string): string | null;
  getAll?(name: string): string[];
}

/**
 * Parse URL query parameters into a validated list query. Invalid values are
 * silently dropped (never forwarded as something the API would reject with
 * 400); `page` and `ordering` are separated for screens to manage apart from
 * the filters.
 */
export function parseListQuery(params: QueryReader): SiteListQuery {
  const query: SiteListQuery = {};
  const getSingle = (name: string): string | null => {
    const values = params.getAll?.(name);
    return values && values.length !== 1 ? null : params.get(name);
  };

  const search = getSingle("search")?.trim();
  if (search) query.search = search.slice(0, 255);

  const code = getSingle("code")?.trim();
  if (code && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) {
    query.code = code.toUpperCase();
  }

  const status = getSingle("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    query.status = status as SiteStatus;
  }

  const owner = getSingle("organization_unit");
  if (
    owner &&
    /^\d{1,19}$/.test(owner) &&
    Number.isSafeInteger(Number(owner)) &&
    Number(owner) > 0
  ) {
    query.organization_unit = Number(owner);
  }

  const page = getSingle("page");
  if (page && /^\d{1,9}$/.test(page) && Number(page) > 1) {
    query.page = Number(page);
  }

  const sort = sortFromOrdering(getSingle("ordering"));
  if (sort.field !== DEFAULT_SORT.field || sort.direction !== DEFAULT_SORT.direction) {
    const ordering = orderingFromSort(sort);
    if (ordering) query.ordering = ordering;
  }

  return query;
}

/** Seed the filter draft from a parsed URL query (or an applied query). */
export function draftFromQuery(query: SiteListQuery): SiteListDraft {
  return {
    search: query.search ?? "",
    code: query.code ?? "",
    status: query.status ?? "",
    organization_unit:
      query.organization_unit === undefined ? "" : String(query.organization_unit),
  };
}

/** Convert the draft controls' state into a list query (filters only). */
export function draftToQuery(draft: SiteListDraft): SiteListQuery {
  const query: SiteListQuery = {};
  const search = draft.search.trim();
  if (search) query.search = search.slice(0, 255);
  const code = draft.code.trim();
  if (code && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) {
    query.code = code.toUpperCase();
  }
  if (draft.status) query.status = draft.status as SiteStatus;
  if (
    draft.organization_unit &&
    /^\d+$/.test(draft.organization_unit) &&
    Number.isSafeInteger(Number(draft.organization_unit))
  ) {
    query.organization_unit = Number(draft.organization_unit);
  }
  return query;
}

/** Serialize a list query into URL search parameters, omitting defaults. */
export function queryToSearchParams(query: SiteListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.code) params.set("code", query.code);
  if (query.status) params.set("status", query.status);
  if (query.organization_unit !== undefined) {
    params.set("organization_unit", String(query.organization_unit));
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.ordering) params.set("ordering", query.ordering);
  return params;
}

/**
 * Map a table sort state to the backend `ordering` parameter. The table
 * sorts one column at a time; the backend appends its unique `code`
 * tie-breaker itself, and the default sort is omitted entirely.
 */
export function orderingFromSort(
  sort: SortState | null | undefined,
): string | undefined {
  if (!sort) return undefined;
  if (
    !SITE_ORDERING_FIELDS.includes(
      sort.field as (typeof SITE_ORDERING_FIELDS)[number],
    )
  ) {
    return undefined;
  }
  if (sort.field === DEFAULT_SORT.field && sort.direction === DEFAULT_SORT.direction) {
    return undefined;
  }
  return sort.direction === "desc" ? `-${sort.field}` : sort.field;
}

/** Parse an `ordering` parameter into a table sort state (never invalid). */
export function sortFromOrdering(ordering: string | null | undefined): SortState {
  if (!ordering) return DEFAULT_SORT;
  const descending = ordering.startsWith("-");
  const field = descending ? ordering.slice(1) : ordering;
  if (
    !(SITE_ORDERING_FIELDS as readonly string[]).includes(field) ||
    ordering.includes(",")
  ) {
    // Multi-field orderings are valid on the API but not expressible by the
    // single-sort table; fall back to the default rather than guessing.
    return DEFAULT_SORT;
  }
  return { field, direction: descending ? "desc" : "asc" };
}
