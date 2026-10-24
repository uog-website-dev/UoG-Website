/**
 * Swappable Organizations data adapters.
 *
 * Two implementations satisfy the same `OrganizationsAdapter` interface:
 *
 *   - `createLiveOrganizationsAdapter` talks to the real Django API at
 *     /api/v1/organizations/ through the typed HTTP client (structured
 *     errors, request ids, ETag preconditions).
 *   - `createMockOrganizationsAdapter` serves the in-repo fixtures for local
 *     UI work with no backend running.
 *
 * The adapter is chosen *explicitly* by environment (see ./mode.ts). There is
 * no implicit fallback: when the app is built for deployment the mock is
 * refused outright, so a deployed integration can never serve a fabricated
 * response.
 */
import type {
  ETaggedResponse,
  Organization,
  OrganizationListQuery,
  PaginatedResponse,
} from "@uog/types";

import { ApiError, createApiClient } from "../client";
import { buildQueryString, withQuery } from "../query";
import { organizationFixtures } from "../fixtures/organizations";

/** Page size the backend enforces (20 per page, not client-selectable). */
export const ORGANIZATIONS_PAGE_SIZE = 20;

export interface OrganizationsAdapter {
  /** Paged, filtered organization list. */
  list(query?: OrganizationListQuery): Promise<PaginatedResponse<Organization>>;
  /** Single organization including the strong ETag for mutations. */
  get(id: number): Promise<ETaggedResponse<Organization>>;
  /** Create an organization (development opt-in on the backend). */
  create(input: OrganizationCreateInput): Promise<ETaggedResponse<Organization>>;
  /** Conditional partial update; `etag` must be the current strong ETag. */
  update(
    id: number,
    etag: string,
    input: OrganizationUpdateInput,
  ): Promise<ETaggedResponse<Organization>>;
  /** ACTIVE -> INACTIVE; requires the current strong ETag. */
  deactivate(id: number, etag: string): Promise<ETaggedResponse<Organization>>;
  /** INACTIVE -> ARCHIVED; requires the current strong ETag. */
  archive(id: number, etag: string): Promise<ETaggedResponse<Organization>>;
}

/** Writable fields accepted by create. */
export interface OrganizationCreateInput {
  code: string;
  name: string;
  organization_type: string;
  parent?: number | null;
  short_name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Writable fields accepted by partial update (code is immutable). */
export type OrganizationUpdateInput = Partial<
  Omit<OrganizationCreateInput, "code">
>;

const ORGANIZATIONS_PATH = "/v1/organizations/";

/** Build the validated discovery query string for the list endpoint. */
export function organizationListQueryString(
  query: OrganizationListQuery = {},
): string {
  return buildQueryString({
    search: query.search,
    name: query.name,
    code: query.code,
    type: query.type,
    // `parent` is a bigint id, or the literal string "null" for roots.
    parent:
      query.parent === undefined
        ? undefined
        : query.parent === "null"
          ? "null"
          : String(query.parent),
    status: query.status,
    ordering: query.ordering,
    page: query.page,
  });
}

/** Live adapter: real Django API via the typed HTTP client. */
export function createLiveOrganizationsAdapter(options: {
  baseUrl: string;
  accessToken?: string;
  fetchFn?: typeof fetch;
}): OrganizationsAdapter {
  const client = createApiClient({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  return {
    async list(query) {
      const path = withQuery(
        ORGANIZATIONS_PATH,
        organizationListQueryString(query),
      );
      return client.get<PaginatedResponse<Organization>>(path);
    },
    async get(id) {
      const result = await client.getDetailed<Organization>(
        `${ORGANIZATIONS_PATH}${id}/`,
      );
      return {
        data: result.data,
        etag: result.etag,
        requestId: result.requestId,
      } satisfies ETaggedResponse<Organization>;
    },
    async create(input) {
      const result = await client.postDetailed<Organization>(
        ORGANIZATIONS_PATH,
        input,
      );
      return {
        data: result.data,
        etag: result.etag,
        requestId: result.requestId,
      } satisfies ETaggedResponse<Organization>;
    },
    async update(id, etag, input) {
      const result = await client.patchDetailed<Organization>(
        `${ORGANIZATIONS_PATH}${id}/`,
        input,
        { ifMatch: etag },
      );
      return {
        data: result.data,
        etag: result.etag,
        requestId: result.requestId,
      } satisfies ETaggedResponse<Organization>;
    },
    async deactivate(id, etag) {
      const result = await client.postDetailed<Organization>(
        `${ORGANIZATIONS_PATH}${id}/deactivate/`,
        {},
        { headers: { "If-Match": etag } },
      );
      return {
        data: result.data,
        etag: result.etag,
        requestId: result.requestId,
      } satisfies ETaggedResponse<Organization>;
    },
    async archive(id, etag) {
      const result = await client.postDetailed<Organization>(
        `${ORGANIZATIONS_PATH}${id}/archive/`,
        {},
        { headers: { "If-Match": etag } },
      );
      return {
        data: result.data,
        etag: result.etag,
        requestId: result.requestId,
      } satisfies ETaggedResponse<Organization>;
    },
  };
}

/**
 * Mock adapter: serves the in-repo fixtures.
 *
 * It reproduces the backend's observable behaviour so screens can be built
 * without a running stack: page-number pagination at the fixed page size,
 * the same discovery filters, strong ETags that change when an entity
 * changes, 409 on stale ETag and 404 for unknown ids. Latency is simulated
 * so loading states are visible during local development.
 */
export function createMockOrganizationsAdapter(options?: {
  seed?: Organization[];
  latencyMs?: number;
}): OrganizationsAdapter {
  const latencyMs = options?.latencyMs ?? 150;
  let store: Organization[] = (options?.seed ?? organizationFixtures).map(
    (organization) => ({ ...organization, metadata: { ...organization.metadata } }),
  );
  let nextId = store.reduce((max, org) => Math.max(max, org.id), 0) + 1;

  const wait = () =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  /** Deterministic strong ETag derived from the representation, like the API. */
  const etagFor = (organization: Organization): string =>
    `"mock-${organization.id}-${organization.updated_at}"`;

  const require = (id: number): Organization => {
    const found = store.find((org) => org.id === id);
    if (!found) {
      throw new ApiError("The requested resource was not found.", 404, {
        code: "not_found",
        details: { detail: "No OrganizationUnit matches the given query." },
      });
    }
    return found;
  };

  const checkEtag = (organization: Organization, etag: string) => {
    if (etag !== etagFor(organization)) {
      throw new ApiError(
        "The organization changed. Retrieve it and reconcile your changes.",
        412,
        { code: "precondition_failed" },
      );
    }
  };

  const respond = (
    organization: Organization,
    requestId: string,
  ): ETaggedResponse<Organization> => ({
    data: { ...organization },
    etag: etagFor(organization),
    requestId,
  });

  const mockRequestId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `mock-${Math.random().toString(36).slice(2, 10)}`;

  return {
    async list(query = {}) {
      await wait();
      let results = [...store];

      if (query.search) {
        const needle = query.search.trim().toLowerCase();
        results = results.filter(
          (org) =>
            org.name.toLowerCase().includes(needle) ||
            org.code.toLowerCase().includes(needle),
        );
      }
      if (query.name) {
        const needle = query.name.trim().toLowerCase();
        results = results.filter((org) => org.name.toLowerCase().includes(needle));
      }
      if (query.code) {
        const code = query.code.trim().toUpperCase();
        results = results.filter((org) => org.code === code);
      }
      if (query.type) {
        results = results.filter((org) => org.organization_type === query.type);
      }
      if (query.parent !== undefined) {
        results = results.filter((org) =>
          query.parent === "null"
            ? org.parent === null
            : org.parent === Number(query.parent),
        );
      }
      if (query.status) {
        results = results.filter((org) => org.status === query.status);
      }

      const ordering = (query.ordering ?? "code").split(",");
      for (const field of [...ordering].reverse()) {
        const descending = field.startsWith("-");
        const key = (field.startsWith("-") ? field.slice(1) : field) as keyof Organization;
        results.sort((a, b) => {
          const left = a[key];
          const right = b[key];
          const cmp =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right));
          return descending ? -cmp : cmp;
        });
      }

      const count = results.length;
      const page = Math.max(1, query.page ?? 1);
      const start = (page - 1) * ORGANIZATIONS_PAGE_SIZE;
      const pageResults = results.slice(
        start,
        start + ORGANIZATIONS_PAGE_SIZE,
      );
      const hasNext = start + ORGANIZATIONS_PAGE_SIZE < count;

      return {
        count,
        next: hasNext ? `?page=${page + 1}` : null,
        previous: page > 1 ? `?page=${page - 1}` : null,
        results: pageResults.map((org) => ({ ...org })),
      } satisfies PaginatedResponse<Organization>;
    },

    async get(id) {
      await wait();
      return respond(require(id), mockRequestId());
    },

    async create(input) {
      await wait();
      const code = input.code.trim().toUpperCase();
      if (store.some((org) => org.code === code)) {
        throw new ApiError(
          "The request conflicts with the current resource state.",
          409,
          {
            code: "conflict",
            details: { code: ["An organization with this code already exists."] },
          },
        );
      }
      const now = new Date().toISOString();
      const created: Organization = {
        id: nextId++,
        code,
        name: input.name,
        short_name: input.short_name ?? "",
        organization_type: input.organization_type,
        parent: input.parent ?? null,
        description: input.description ?? "",
        status: "ACTIVE",
        metadata: input.metadata ?? {},
        created_at: now,
        updated_at: now,
      };
      store.push(created);
      return respond(created, mockRequestId());
    },

    async update(id, etag, input) {
      await wait();
      const organization = require(id);
      checkEtag(organization, etag);
      const updated: Organization = {
        ...organization,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.short_name !== undefined ? { short_name: input.short_name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.parent !== undefined ? { parent: input.parent } : {}),
        updated_at: new Date().toISOString(),
      };
      store = store.map((org) => (org.id === id ? updated : org));
      return respond(updated, mockRequestId());
    },

    async deactivate(id, etag) {
      await wait();
      const organization = require(id);
      checkEtag(organization, etag);
      const updated: Organization = {
        ...organization,
        status: "INACTIVE",
        updated_at: new Date().toISOString(),
      };
      store = store.map((org) => (org.id === id ? updated : org));
      return respond(updated, mockRequestId());
    },

    async archive(id, etag) {
      await wait();
      const organization = require(id);
      checkEtag(organization, etag);
      const updated: Organization = {
        ...organization,
        status: "ARCHIVED",
        updated_at: new Date().toISOString(),
      };
      store = store.map((org) => (org.id === id ? updated : org));
      return respond(updated, mockRequestId());
    },
  };
}
