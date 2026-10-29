/**
 * Swappable User Assignment & Access Management adapters.
 *
 * Two implementations satisfy the same `IamAdapter`:
 *
 *   - `createLiveIamAdapter` talks to the platform API through the typed
 *     HTTP client: `/v1/users/` (lookup), `/v1/access/me/` (what the caller
 *     may manage), `/v1/users/{id}/access/` (effective permissions),
 *     `/v1/assignments/` (list/detail/create, and a conditional DELETE for
 *     revoke) and `/v1/audit/` (the append-only trail).
 *   - `createMockIamAdapter` serves the in-repo fixtures for local UI work
 *     with no backend running, reproducing the contract's observable
 *     behaviour: search, filters, pagination, the authorization boundary
 *     (you may never grant beyond your own authority), duplicate grants as
 *     409, stale ETags as 412 and unknown ids as 404.
 *
 * The adapter is chosen *explicitly* by environment (see ./mode.ts), so a
 * production build only ever constructs the live adapter and a deployed
 * integration can never serve a fabricated response.
 *
 * STATUS: the IAM backend endpoints are not implemented yet (P2-IAM-004 is
 * the server-side story). Until they exist, collection reads answer 404 and
 * the live adapter converts that into a 501 `not_implemented` ApiError, so
 * the screens show an honest "not available yet" state instead of data they
 * cannot actually fetch. No response body is ever invented in live mode.
 *
 * Security: this layer is transport only. It never decides *who* may act —
 * the backend re-checks every request against the caller's own roles, so a
 * permissive mock or a stale token cannot grant anything on its own.
 */
import type {
  AssignmentAuditEvent,
  AssignmentCreateInput,
  AssignmentListQuery,
  AssignmentScopeType,
  CallerAccess,
  EffectiveAccess,
  PaginatedResponse,
  PlatformRole,
  PlatformUser,
  UserAssignment,
  UserSearchQuery,
} from "@uog/types";

import { ApiError, createApiClient } from "../client";
import { buildQueryString, withQuery } from "../query";
import { organizationFixtures } from "../fixtures/organizations";
import { siteFixtures } from "../fixtures/sites";
import {
  ROLE_CATALOG,
  assignmentFixtures,
  auditEventFixtures,
  effectiveAccessFixtures,
  userFixtures,
} from "../fixtures/iam";

/** Page size the backend enforces (20 per page, not client-selectable). */
export const IAM_PAGE_SIZE = 20;


export interface IamAdapter {
  /** Platform user lookup (Keycloak-backed); case-insensitive substring. */
  searchUsers(query?: UserSearchQuery): Promise<PaginatedResponse<PlatformUser>>;
  /**
   * What the signed-in administrator may manage, computed by the backend
   * from their own roles and grants. The console offers only these roles
   * and scopes — a usability boundary that the backend re-enforces anyway.
   */
  getCallerAccess(): Promise<CallerAccess>;
  /** Backend-computed effective permissions for one user. 404 if unknown. */
  getEffectiveAccess(userId: string): Promise<EffectiveAccess>;
  /** Paged, filtered assignment list. */
  listAssignments(query?: AssignmentListQuery): Promise<PaginatedResponse<UserAssignment>>;
  /** One assignment including the strong ETag required for revocation. */
  getAssignment(id: number): Promise<ETagged<UserAssignment>>;
  /**
   * `POST /api/v1/assignments/` — grant a role within one scope. The
   * backend answers 403 when the caller may not grant that role or manage
   * that scope, 409 for a duplicate grant and 400 for a missing scope id.
   */
  createAssignment(input: AssignmentCreateInput): Promise<ETagged<UserAssignment>>;
  /**
   * `DELETE /api/v1/assignments/{id}/` — conditional on `etag`, so a stale
   * view can never revoke a grant that changed since it was read.
   */
  revokeAssignment(id: number, etag: string): Promise<void>;
  /** Append-only audit trail entries for the access-management screens. */
  listAuditEvents(query?: { entity_type?: string; page?: number }): Promise<
    PaginatedResponse<AssignmentAuditEvent>
  >;
}

/** Local alias mirroring the ETaggedResponse shape used by the other adapters. */
type ETagged<T> = { data: T; etag: string | null; requestId: string | null };

const USERS_PATH = "/v1/users/";
const ACCESS_ME_PATH = "/v1/access/me/";
const ASSIGNMENTS_PATH = "/v1/assignments/";
const AUDIT_PATH = "/v1/audit/";

/** Role strength: higher grants more. A caller never grants above its own. */
const ROLE_RANK: Record<PlatformRole, number> = {
  "platform-viewer": 1,
  "platform-editor": 2,
  "platform-admin": 3,
};

/** Roles a caller holding these roles is allowed to grant (mock only). */
export function grantableRoles(roles: readonly string[]): PlatformRole[] {
  const ranks = roles
    .map((role) => ROLE_RANK[role as PlatformRole] ?? 0)
    .filter((rank) => rank > 0);
  const own = ranks.length > 0 ? Math.max(...ranks) : 0;
  // A read-only viewer may not assign at all; everyone else may grant
  // roles at or below their own strength — never above.
  if (own < ROLE_RANK["platform-editor"]) return [];
  return ROLE_CATALOG.filter((entry) => ROLE_RANK[entry.code] <= own).map(
    (entry) => entry.code,
  );
}

/**
 * Map a collection read that the IAM API does not serve (yet) onto an
 * explicit "not implemented" error. Detail reads keep their real 404, since
 * an unknown user or assignment is a genuine not-found once the API ships.
 */
async function requireImplemented<T>(promise: Promise<T>, endpoint: string): Promise<T> {
  try {
    return await promise;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      throw new ApiError(
        `The access-management API is not available in this environment ` +
          `(${endpoint} answered 404). The IAM backend (P2-IAM-004) must be ` +
          `deployed before this screen can read real data — nothing is substituted.`,
        501,
        { code: "not_implemented", requestId: cause.requestId },
      );
    }
    throw cause;
  }
}

function page<T>(results: T[], count: number, page: number): PaginatedResponse<T> {
  const start = (page - 1) * IAM_PAGE_SIZE;
  return {
    count,
    next: start + IAM_PAGE_SIZE < count ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: results.slice(start, start + IAM_PAGE_SIZE),
  };
}

/** Live adapter: the real platform API via the typed HTTP client. */
export function createLiveIamAdapter(options: {
  baseUrl: string;
  accessToken?: string;
  fetchFn?: typeof fetch;
}): IamAdapter {
  const client = createApiClient({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  const toEtagged = <T>(result: {
    data: T;
    etag: string | null;
    requestId: string | null;
  }): ETagged<T> => ({
    data: result.data,
    etag: result.etag,
    requestId: result.requestId,
  });

  return {
    searchUsers(query = {}) {
      const qs = buildQueryString({ search: query.search, page: query.page });
      return requireImplemented(
        client.get<PaginatedResponse<PlatformUser>>(withQuery(USERS_PATH, qs)),
        "GET /api/v1/users/",
      );
    },

    getCallerAccess() {
      return requireImplemented(
        client.get<CallerAccess>(ACCESS_ME_PATH),
        "GET /api/v1/access/me/",
      );
    },

    getEffectiveAccess(userId) {
      // A real detail read: an unknown subject stays a genuine 404.
      return client.get<EffectiveAccess>(
        `${USERS_PATH}${encodeURIComponent(userId)}/access/`,
      );
    },

    listAssignments(query = {}) {
      const qs = buildQueryString({
        user: query.user,
        role: query.role,
        scope_type: query.scope_type,
        scope_id: query.scope_id,
        ordering: query.ordering,
        page: query.page,
      });
      return requireImplemented(
        client.get<PaginatedResponse<UserAssignment>>(withQuery(ASSIGNMENTS_PATH, qs)),
        "GET /api/v1/assignments/",
      );
    },

    async getAssignment(id) {
      const result = await client.getDetailed<UserAssignment>(
        `${ASSIGNMENTS_PATH}${id}/`,
      );
      return toEtagged(result);
    },

    async createAssignment(input) {
      const result = await client.postDetailed<UserAssignment>(
        ASSIGNMENTS_PATH,
        input,
      );
      return toEtagged(result);
    },

    async revokeAssignment(id, etag) {
      await client.delDetailed<void>(`${ASSIGNMENTS_PATH}${id}/`, {
        ifMatch: etag,
      });
    },

    listAuditEvents(query = {}) {
      const qs = buildQueryString({
        entity_type: query.entity_type ?? "UserAssignment",
        page: query.page,
      });
      return requireImplemented(
        client.get<PaginatedResponse<AssignmentAuditEvent>>(withQuery(AUDIT_PATH, qs)),
        "GET /api/v1/audit/",
      );
    },
  };
}

export interface MockIamAdapterOptions {
  /** Simulated latency (ms). Default 150. */
  latencyMs?: number;
  /**
   * Roles of the signed-in administrator, used to derive what the mock lets
   * them grant and manage. Defaults to the development administrator.
   */
  callerRoles?: readonly string[];
  /**
   * Scopes the caller manages. When omitted the mock grants a platform
   * administrator every known scope and anyone else none; tests pass an
   * explicit list to simulate a site-scoped administrator.
   */
  manageableScopes?: CallerAccess["manageable_scopes"];
  /** Username reported as the acting administrator. */
  callerUsername?: string;
}

/**
 * Mock adapter: the in-repo fixtures plus the contract's observable rules,
 * held in an in-memory store so a create or revoke is visible to later
 * reads within the same server process.
 */
export function createMockIamAdapter(options: MockIamAdapterOptions = {}): IamAdapter {
  const latencyMs = options.latencyMs ?? 150;
  const callerUsername = options.callerUsername ?? "devuser";
  const callerRoles = options.callerRoles ?? ["platform-admin"];
  const assignable = grantableRoles(callerRoles);

  const users = userFixtures.map((user) => ({ ...user }));
  let assignments = assignmentFixtures.map((assignment) => ({ ...assignment }));
  let audit = auditEventFixtures.map((event) => ({ ...event }));
  let nextAssignmentId = 1000;
  let nextAuditId = 10_000;
  /** Concurrency token per assignment, bumped on every write. */
  const versions = new Map<number, number>(assignments.map((a) => [a.id, 1]));

  const wait = () =>
    new Promise<void>((resolve) => setTimeout(resolve, latencyMs));

  const etagOf = (id: number) =>
    `"assignment-${id}-v${versions.get(id) ?? 1}"`;

  const callerAccess = (): CallerAccess => {
    const manageable =
      options.manageableScopes ??
      (assignable.includes("platform-admin")
        ? [
            { type: "PLATFORM" as AssignmentScopeType, id: null, label: "Whole platform" },
            ...scopeOptionsForMock(),
          ]
        : []);
    return {
      username: callerUsername,
      roles: [...callerRoles] as PlatformRole[],
      assignable_roles: assignable,
      manageable_scopes: manageable,
    };
  };

  const canManage = (scope: {
    type: AssignmentScopeType;
    id: number | null;
  }): boolean => {
    const { manageable_scopes: scopes } = callerAccess();
    return scopes.some(
      (candidate) => candidate.type === scope.type && candidate.id === scope.id,
    );
  };

  const scopeLabel = (type: AssignmentScopeType, id: number | null): string => {
    if (type === "PLATFORM") return "Whole platform";
    if (id === null) return type === "SITE" ? "Site" : "Organization";
    if (type === "SITE") {
      const site = siteFixtures.find((fixture) => fixture.id === id);
      return site ? `${site.name} (${site.code})` : `Site ${id}`;
    }
    const organization = organizationFixtures.find((fixture) => fixture.id === id);
    return organization
      ? `${organization.name} (${organization.code})`
      : `Organization ${id}`;
  };

  const recordAudit = (action: string, assignment: UserAssignment) => {
    audit = [
      {
        id: nextAuditId++,
        action,
        entity_type: "UserAssignment",
        entity_id: String(assignment.id),
        actor_kind: "USER",
        actor_id: callerUsername,
        timestamp: new Date().toISOString(),
        request_id: null,
      },
      ...audit,
    ];
  };

  return {
    async searchUsers(query = {}) {
      await wait();
      let results = [...users];
      const needle = query.search?.trim().toLowerCase();
      if (needle) {
        results = results.filter((user) =>
          `${user.username} ${user.email} ${user.first_name} ${user.last_name}`
            .toLowerCase()
            .includes(needle),
        );
      }
      const pageNumber = Math.max(1, query.page ?? 1);
      return page(
        results.map((user) => ({ ...user })),
        results.length,
        pageNumber,
      );
    },

    async getCallerAccess() {
      await wait();
      return callerAccess();
    },

    async getEffectiveAccess(userId) {
      await wait();
      const user = users.find((candidate) => candidate.id === userId);
      if (!user) {
        throw new ApiError("This user does not exist.", 404, { code: "not_found" });
      }
      return {
        user_id: user.id,
        username: user.username,
        permissions: effectiveAccessFixtures(user, assignments),
      };
    },

    async listAssignments(query = {}) {
      await wait();
      let results = [...assignments];
      if (query.user) results = results.filter((a) => a.user_id === query.user);
      if (query.role) results = results.filter((a) => a.role === query.role);
      if (query.scope_type) {
        results = results.filter((a) => a.scope_type === query.scope_type);
      }
      if (query.scope_id !== undefined) {
        results = results.filter((a) => a.scope_id === query.scope_id);
      }
      const descending = (query.ordering ?? "-created_at").startsWith("-");
      const field = (query.ordering ?? "-created_at").replace(/^-/, "");
      results.sort((left, right) => {
        const a = String(left[field as keyof UserAssignment] ?? "");
        const b = String(right[field as keyof UserAssignment] ?? "");
        return descending ? b.localeCompare(a) : a.localeCompare(b);
      });
      return page(
        results.map((a) => ({ ...a })),
        results.length,
        Math.max(1, query.page ?? 1),
      );
    },

    async getAssignment(id) {
      await wait();
      const assignment = assignments.find((candidate) => candidate.id === id);
      if (!assignment) {
        throw new ApiError("This assignment does not exist.", 404, {
          code: "not_found",
        });
      }
      return { data: { ...assignment }, etag: etagOf(id), requestId: null };
    },

    async createAssignment(input) {
      await wait();
      const user = users.find((candidate) => candidate.id === input.user_id);
      if (!user) {
        throw new ApiError("This user does not exist.", 404, { code: "not_found" });
      }
      if (!assignable.includes(input.role)) {
        throw new ApiError(
          `You are not allowed to grant "${input.role}". You may grant: ${
            assignable.length > 0 ? assignable.join(", ") : "nothing"
          }.`,
          403,
          { code: "permission_denied" },
        );
      }
      const scopeType = input.scope_type;
      const scopeId = scopeType === "PLATFORM" ? null : (input.scope_id ?? null);
      if (scopeType !== "PLATFORM" && scopeId === null) {
        throw new ApiError("A scope id is required for this scope type.", 400, {
          code: "validation_error",
          details: {
            scope_id: ["Select a scope before assigning this role."],
          },
        });
      }
      if (!canManage({ type: scopeType, id: scopeId })) {
        throw new ApiError(
          "You do not manage this scope, so you cannot assign roles within it.",
          403,
          { code: "permission_denied" },
        );
      }
      const duplicate = assignments.find(
        (candidate) =>
          candidate.user_id === input.user_id &&
          candidate.role === input.role &&
          candidate.scope_type === scopeType &&
          candidate.scope_id === scopeId,
      );
      if (duplicate) {
        throw new ApiError(
          `${user.username} already holds "${input.role}" in ${duplicate.scope_label}.`,
          409,
          { code: "conflict" },
        );
      }

      const created: UserAssignment = {
        id: nextAssignmentId++,
        user_id: user.id,
        username: user.username,
        role: input.role,
        scope_type: scopeType,
        scope_id: scopeId,
        scope_label: scopeLabel(scopeType, scopeId),
        created_at: new Date().toISOString(),
        created_by: callerUsername,
      };
      assignments = [created, ...assignments];
      versions.set(created.id, 1);
      recordAudit("assignment.created", created);
      return { data: { ...created }, etag: etagOf(created.id), requestId: null };
    },

    async revokeAssignment(id, etag) {
      await wait();
      const assignment = assignments.find((candidate) => candidate.id === id);
      if (!assignment) {
        throw new ApiError("This assignment does not exist.", 404, {
          code: "not_found",
        });
      }
      if (etag !== etagOf(id)) {
        throw new ApiError(
          "This assignment changed since it was read; reload and try again.",
          412,
          { code: "precondition_failed" },
        );
      }
      if (
        !canManage({ type: assignment.scope_type, id: assignment.scope_id })
      ) {
        throw new ApiError(
          "You do not manage this scope, so you cannot revoke roles within it.",
          403,
          { code: "permission_denied" },
        );
      }
      assignments = assignments.filter((candidate) => candidate.id !== id);
      versions.delete(id);
      recordAudit("assignment.revoked", assignment);
    },

    async listAuditEvents(query = {}) {
      await wait();
      const entityType = query.entity_type ?? "UserAssignment";
      const results = audit.filter((event) => event.entity_type === entityType);
      return page(
        results.map((event) => ({ ...event })),
        results.length,
        Math.max(1, query.page ?? 1),
      );
    },
  };
}

/**
 * Scope options the mock offers a platform administrator: every fixture
 * Site and Organization, resolved to the same labels the backend resolves.
 */
function scopeOptionsForMock(): CallerAccess["manageable_scopes"] {
  return [
    ...siteFixtures.map((site) => ({
      type: "SITE" as AssignmentScopeType,
      id: site.id,
      label: `${site.name} (${site.code})`,
    })),
    ...organizationFixtures.map((organization) => ({
      type: "ORGANIZATION" as AssignmentScopeType,
      id: organization.id,
      label: `${organization.name} (${organization.code})`,
    })),
  ];
}
