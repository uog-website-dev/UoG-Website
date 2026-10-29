"use server";

/**
 * User assignment and access-management reads and writes, executed on the
 * server.
 *
 * Same contract as the organization and site actions: the Keycloak access
 * token lives only in the Auth.js session cookie, is read here server-side
 * and handed to the adapter as an Authorization header — never returned to
 * the browser, never placed in a query string and never logged.
 *
 * Every action returns a clone-safe `ActionResult` (see
 * @/organizations/contract), with any `ApiError` flattened for the
 * React Server Component boundary and rebuilt on the client.
 *
 * Authorization is not decided here. The adapter resolves `API_MODE`, so a
 * production build only ever talks to the live API, and the IAM backend
 * independently enforces authentication, the caller's own roles and scopes,
 * and duplicate/conflict rules. Its 403/409 answers are surfaced verbatim
 * rather than masked — the frontend never substitutes for those checks.
 */
import { ApiError, apiModeFromEnv, createIamAdapter } from "@uog/api-client";
import type { AssignmentCreateInput, ETaggedResponse } from "@uog/types";
import type {
  AssignmentAuditEvent,
  AssignmentListQuery,
  CallerAccess,
  EffectiveAccess,
  PaginatedResponse,
  PlatformUser,
  UserAssignment,
  UserSearchQuery,
} from "@uog/types";

import { getAccessToken, getSessionClaims } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

/**
 * Internal Docker URL for server-side calls. Browser-side requests go through
 * nginx at `/api`; these run inside the compose network instead.
 */
function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

// The mock adapter owns an in-memory store (and the signed-in administrator's
// derived authority); keep it per server process so mock mutations stay
// visible to later reads. Live adapters remain request-scoped because they
// are bound to the current user's token.
let mockIamAdapter: ReturnType<typeof createIamAdapter> | undefined;

/** Build a request-scoped live adapter or the shared development mock. */
async function buildAdapter() {
  const mode = apiModeFromEnv();
  if (mode === "mock") {
    if (!mockIamAdapter) {
      const claims = await getSessionClaims();
      mockIamAdapter = createIamAdapter({
        mode,
        callerRoles: claims.roles.length > 0 ? claims.roles : undefined,
        callerUsername: claims.username ?? undefined,
      });
    }
    return mockIamAdapter;
  }

  const accessToken = await getAccessToken();
  return createIamAdapter({
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

/** Platform user lookup (Keycloak-backed), for the search panel. */
export async function searchUsers(
  query: UserSearchQuery = {},
): Promise<ActionResult<PaginatedResponse<PlatformUser>>> {
  return attempt((adapter) => adapter.searchUsers(query));
}

/**
 * What the signed-in administrator may manage: their roles, the roles they
 * may grant and the scopes they may act within. Computed by the backend in
 * live mode — the console only renders it.
 */
export async function getCallerAccess(): Promise<ActionResult<CallerAccess>> {
  return attempt((adapter) => adapter.getCallerAccess());
}

/** Backend-computed effective permissions for one user (read-only). */
export async function getEffectiveAccess(
  userId: string,
): Promise<ActionResult<EffectiveAccess>> {
  return attempt((adapter) => adapter.getEffectiveAccess(userId));
}

/** Paged assignment list, optionally scoped to one user. */
export async function listAssignments(
  query: AssignmentListQuery = {},
): Promise<ActionResult<PaginatedResponse<UserAssignment>>> {
  return attempt((adapter) => adapter.listAssignments(query));
}

/** Grant a role within a scope; the backend re-checks the caller's rights. */
export async function createAssignment(
  input: AssignmentCreateInput,
): Promise<ActionResult<ETaggedResponse<UserAssignment>>> {
  return attempt((adapter) => adapter.createAssignment(input));
}

/**
 * Revoke a grant against a freshly fetched strong ETag, so a stale row can
 * never silently revoke an assignment that has since changed.
 */
export async function revokeAssignment(
  id: number,
): Promise<ActionResult<void>> {
  return attempt(async (adapter) => {
    const current = await adapter.getAssignment(id);
    if (!current.etag) {
      throw new ApiError(
        "The server did not return a concurrency token; nothing was revoked.",
        428,
        { code: "precondition_required", requestId: current.requestId },
      );
    }
    await adapter.revokeAssignment(id, current.etag);
  });
}

/** Append-only audit entries shown on the access-management screen. */
export async function listAssignmentAudit(): Promise<
  ActionResult<PaginatedResponse<AssignmentAuditEvent>>
> {
  return attempt((adapter) => adapter.listAuditEvents());
}
