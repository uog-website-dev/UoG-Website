"use server";

/**
 * Organization mutations and reads, executed on the server.
 *
 * The Keycloak access token lives only in the Auth.js session cookie, so every
 * call here reads it server-side and hands it to the adapter as an
 * Authorization header. It is never returned to the browser, never placed in a
 * query string and never logged: the adapter's `redactCredentials` runs over
 * errors before they are serialized.
 *
 * Each action returns a clone-safe `ActionResult`. Failures are flattened to
 * an `ApiErrorPayload` because `ApiError`'s getters do not survive the RSC
 * boundary; the client rebuilds a real `ApiError` for the shared UI.
 *
 * Authorization is not decided here. The adapter resolves `API_MODE`, so a
 * production build only ever talks to the live API (`resolveApiMode` refuses
 * `mock` when `NODE_ENV=production`). The Django side independently enforces
 * authentication, the `platform-admin` realm role and the dev-writes gate, and
 * answers 403 when mutation is not enabled in that environment — which these
 * actions surface verbatim rather than masking.
 */
import { ApiError, apiModeFromEnv, createOrganizationsAdapter } from "@uog/api-client";
import type {
  OrganizationCreateInput,
  OrganizationUpdateInput,
} from "@uog/api-client";
import type {
  ETaggedResponse,
  Organization,
  OrganizationHierarchy,
  OrganizationListQuery,
  PaginatedResponse,
} from "@uog/types";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

/**
 * Internal Docker URL for server-side calls. Browser-side requests go through
 * nginx at `/api`; these run inside the compose network instead, so they use
 * the service name directly.
 */
function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

// The mock adapter owns an in-memory store. Keep it for this server process so
// mutations remain visible to subsequent mock reads (each server action is a
// separate invocation). Live adapters remain request-scoped because they are
// bound to the current user's access token.
let mockOrganizationsAdapter:
  | ReturnType<typeof createOrganizationsAdapter>
  | undefined;

/** Build a request-scoped live adapter or the shared development mock. */
async function buildAdapter() {
  const mode = apiModeFromEnv();
  if (mode === "mock") {
    mockOrganizationsAdapter ??= createOrganizationsAdapter({ mode });
    return mockOrganizationsAdapter;
  }

  const accessToken = await getAccessToken();
  return createOrganizationsAdapter({
    baseUrl: apiBaseUrl(),
    accessToken: accessToken ?? undefined,
    mode,
  });
}

/** Run an adapter call, converting any failure into a clone-safe payload. */
async function attempt<T>(
  run: (adapter: Awaited<ReturnType<typeof buildAdapter>>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const adapter = await buildAdapter();
    const data = await run(adapter);
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

/** Paged, filtered organization list for the list screen. */
export async function listOrganizations(
  query: OrganizationListQuery = {},
): Promise<ActionResult<PaginatedResponse<Organization>>> {
  return attempt((adapter) => adapter.list(query));
}

/** Single organization plus the strong ETag required for conditional writes. */
export async function getOrganization(
  id: number,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt((adapter) => adapter.get(id));
}

/** Flat hierarchy used to populate the parent selector. */
export async function getOrganizationTree(): Promise<
  ActionResult<OrganizationHierarchy>
> {
  return attempt((adapter) => adapter.tree());
}

/**
 * Create an organization unit. The backend always creates units ACTIVE and
 * normalizes the code to upper case; duplicate codes answer 409.
 */
export async function createOrganization(
  input: OrganizationCreateInput,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt((adapter) => adapter.create(input));
}

/**
 * Conditional partial update. `etag` must be the strong ETag from the detail
 * read the form was populated from: a stale value answers 412, a missing one
 * 428, so a concurrent edit can never be silently overwritten.
 */
export async function updateOrganization(
  id: number,
  etag: string,
  input: OrganizationUpdateInput,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt((adapter) => adapter.update(id, etag, input));
}

/** Move a unit using a fresh detail ETag; hierarchy rules stay backend-owned. */
export async function moveOrganization(
  id: number,
  parent: number,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt(async (adapter) => {
    const current = await adapter.get(id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; the organization was not moved.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    return adapter.update(id, current.etag, { parent });
  });
}

/** ACTIVE -> INACTIVE. Blocked by the backend for roots and active children. */
export async function deactivateOrganization(
  id: number,
  etag: string,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt((adapter) => adapter.deactivate(id, etag));
}

/** INACTIVE -> ARCHIVED. The final state; archived units are frozen. */
export async function archiveOrganization(
  id: number,
  etag: string,
): Promise<ActionResult<ETaggedResponse<Organization>>> {
  return attempt((adapter) => adapter.archive(id, etag));
}
