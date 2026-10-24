/**
 * Swappable Sites data adapters.
 *
 * The Django backend does not expose a Sites API yet (there is no `sites`
 * app; see backend/apps/). The console still needs a stable contract, so
 * this module defines the adapter interface plus two implementations:
 *
 *   - `createLiveSitesAdapter` refuses every call with an explicit
 *     `ApiError` instead of inventing a response. A deployed integration
 *     therefore shows an honest "not implemented" state, never fabricated
 *     sites (acceptance criterion: no fabricated API response in deployed
 *     integration mode).
 *   - `createMockSitesAdapter` serves the in-repo fixtures so the Sites
 *     screen can be developed and tested locally with no backend.
 *
 * Selection is explicit by environment (see ./mode.ts).
 */
import type { ETaggedResponse, PaginatedResponse, Site } from "@uog/types";

import { ApiError } from "../client";
import { siteFixtures } from "../fixtures/sites";

export interface SitesAdapter {
  list(query?: SitesListQuery): Promise<PaginatedResponse<Site>>;
  get(id: number): Promise<ETaggedResponse<Site>>;
}

export interface SitesListQuery {
  search?: string;
  status?: Site["status"];
  organization?: number;
  page?: number;
}

/** Raised by the live adapter until the backend ships a Sites endpoint. */
export const SITES_API_UNAVAILABLE_MESSAGE =
  "The Sites API is not available in this environment yet.";

function unavailable(operation: string): never {
  throw new ApiError(
    `${operation} is unavailable: ${SITES_API_UNAVAILABLE_MESSAGE}`,
    501,
    { code: "api_error", requestId: null },
  );
}

/**
 * Live adapter. Every method rejects with an explicit 501 so the screen
 * renders its honest "backend not implemented" state.
 *
 * Each method is `async` so the failure arrives as a *rejected promise* —
 * callers can `await` or `.catch()` it exactly like a real transport error,
 * rather than the call throwing synchronously.
 */
export function createLiveSitesAdapter(): SitesAdapter {
  return {
    list: async () => unavailable("Listing sites"),
    get: async () => unavailable("Fetching a site"),
  };
}

/**
 * Mock adapter. Serves the fixtures with the same pagination, filtering and
 * 404 behaviour the Organizations mock exposes, so both screens exercise the
 * identical UI code paths.
 */
export function createMockSitesAdapter(options?: {
  seed?: Site[];
  latencyMs?: number;
}): SitesAdapter {
  const latencyMs = options?.latencyMs ?? 150;
  let store: Site[] = (options?.seed ?? siteFixtures).map((site) => ({ ...site }));

  const wait = () =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  return {
    async list(query = {}) {
      await wait();
      let results = [...store];

      if (query.search) {
        const needle = query.search.trim().toLowerCase();
        results = results.filter(
          (site) =>
            site.name.toLowerCase().includes(needle) ||
            site.slug.toLowerCase().includes(needle) ||
            site.domains.some((domain) => domain.toLowerCase().includes(needle)),
        );
      }
      if (query.status) {
        results = results.filter((site) => site.status === query.status);
      }
      if (query.organization !== undefined) {
        results = results.filter((site) => site.organization === query.organization);
      }

      const count = results.length;
      const page = Math.max(1, query.page ?? 1);
      const start = (page - 1) * 20;
      const pageResults = results.slice(start, start + 20);

      return {
        count,
        next: start + 20 < count ? `?page=${page + 1}` : null,
        previous: page > 1 ? `?page=${page - 1}` : null,
        results: pageResults.map((site) => ({ ...site })),
      } satisfies PaginatedResponse<Site>;
    },

    async get(id) {
      await wait();
      const found = store.find((site) => site.id === id);
      if (!found) {
        throw new ApiError("The requested resource was not found.", 404, {
          code: "not_found",
        });
      }
      return {
        data: { ...found },
        etag: `"mock-site-${found.id}-${found.updated_at}"`,
        requestId: null,
      } satisfies ETaggedResponse<Site>;
    },
  };
}
