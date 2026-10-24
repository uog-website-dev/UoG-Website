/**
 * URL query-state contract for the organization list screen.
 *
 * The list's applied filters, page and sort live in the URL query string so a
 * view can be shared, bookmarked and reloaded without losing state. This
 * module is the single place that:
 *
 *   - parses a URL into an `OrganizationListQuery`, defensively: the URL is
 *     untrusted input, and the backend answers 400 for unknown, repeated or
 *     invalid parameters, so anything that does not match the documented
 *     contract (see backend/apps/organizations/api/discovery.py) is dropped
 *     rather than forwarded;
 *   - serializes state back into query parameters, omitting defaults so URLs
 *     stay clean;
 *   - maps the table's `SortState` to and from the backend's `ordering`
 *     parameter (code, name, created_at, updated_at; '-' for descending).
 */
import type { OrganizationListQuery, OrganizationStatus } from "@uog/types";
import type { SortState } from "@uog/ui";

/** Ordering fields the backend accepts (discovery.ORDERING_FIELDS). */
export const ORGANIZATION_ORDERING_FIELDS = [
  "code",
  "name",
  "created_at",
  "updated_at",
] as const;

/** Default ordering of the backend: unique code ascending. */
export const DEFAULT_SORT: SortState = { field: "code", direction: "asc" };

/** The lifecycle statuses the backend's discovery filter accepts. */
const STATUSES: readonly OrganizationStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
];

/** Shape of the filter draft the list's controls edit. All values are the
 * raw select/field strings; `""` means "no filter". */
export interface OrganizationListDraft {
  search: string;
  name: string;
  code: string;
  type: string;
  status: string;
  /** `""` all, `"null"` roots only, decimal string otherwise. */
  parent: string;
}

export function emptyDraft(): OrganizationListDraft {
  return { search: "", name: "", code: "", type: "", status: "", parent: "" };
}

/** Minimal read-only view of a query string (URLSearchParams-compatible). */
export interface QueryReader {
  get(name: string): string | null;
  getAll?(name: string): string[];
}

/**
 * Parse URL query parameters into a validated discovery query.
 *
 * Invalid values are silently dropped (never forwarded as a value the API
 * would reject with 400), and `page`/`ordering` are separated out so screens
 * can manage them independently of the filters.
 */
export function parseListQuery(params: QueryReader): OrganizationListQuery {
  const query: OrganizationListQuery = {};
  const getSingle = (name: string): string | null => {
    const values = params.getAll?.(name);
    return values && values.length !== 1 ? null : params.get(name);
  };

  const search = getSingle("search")?.trim();
  if (search) query.search = search.slice(0, 255);

  const name = getSingle("name")?.trim();
  if (name) query.name = name.slice(0, 255);

  const code = getSingle("code")?.trim();
  if (code && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) {
    query.code = code.toUpperCase();
  }

  const type = getSingle("type");
  if (type && /^[A-Z][A-Z0-9_]{0,63}$/.test(type)) query.type = type;

  const status = getSingle("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    query.status = status as OrganizationStatus;
  }

  const parent = getSingle("parent");
  if (parent === "null") {
    query.parent = "null";
  } else if (
    parent &&
    /^\d{1,19}$/.test(parent) &&
    Number.isSafeInteger(Number(parent)) &&
    Number(parent) > 0
  ) {
    query.parent = Number(parent);
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
export function draftFromQuery(query: OrganizationListQuery): OrganizationListDraft {
  return {
    search: query.search ?? "",
    name: query.name ?? "",
    code: query.code ?? "",
    type: query.type ?? "",
    status: query.status ?? "",
    parent: query.parent === undefined ? "" : String(query.parent),
  };
}

/** Convert the draft controls' state into a discovery query (filters only). */
export function draftToQuery(draft: OrganizationListDraft): OrganizationListQuery {
  const query: OrganizationListQuery = {};
  const search = draft.search.trim();
  if (search) query.search = search.slice(0, 255);
  const name = draft.name.trim();
  if (name) query.name = name.slice(0, 255);
  const code = draft.code.trim();
  if (code && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) {
    query.code = code.toUpperCase();
  }
  if (draft.type) query.type = draft.type;
  if (draft.status) query.status = draft.status as OrganizationStatus;
  if (draft.parent === "null") {
    query.parent = "null";
  } else if (/^\d+$/.test(draft.parent) && Number.isSafeInteger(Number(draft.parent))) {
    query.parent = Number(draft.parent);
  }
  return query;
}

/** Serialize a discovery query into URL search parameters, omitting defaults. */
export function queryToSearchParams(query: OrganizationListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.name) params.set("name", query.name);
  if (query.code) params.set("code", query.code);
  if (query.type) params.set("type", query.type);
  if (query.parent !== undefined) params.set("parent", String(query.parent));
  if (query.status) params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.ordering) params.set("ordering", query.ordering);
  return params;
}

/**
 * Map a table sort state to the backend `ordering` parameter.
 *
 * The table sorts one column at a time; the backend appends its unique
 * `code` tie-breaker itself, so a single field is enough. The default sort
 * is omitted — it is what the API does without an `ordering` at all.
 */
export function orderingFromSort(sort: SortState | null | undefined): string | undefined {
  if (!sort) return undefined;
  if (!ORGANIZATION_ORDERING_FIELDS.includes(sort.field as (typeof ORGANIZATION_ORDERING_FIELDS)[number])) {
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
    !(ORGANIZATION_ORDERING_FIELDS as readonly string[]).includes(field) ||
    ordering.includes(",")
  ) {
    // Multi-field orderings are valid on the API but not expressible by the
    // single-sort table; fall back to the default rather than guessing.
    return DEFAULT_SORT;
  }
  return { field, direction: descending ? "desc" : "asc" };
}
