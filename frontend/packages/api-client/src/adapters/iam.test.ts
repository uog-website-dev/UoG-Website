import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../errors";
import { auditEventFixtures, userFixtures } from "../fixtures/iam";
import {
  createLiveIamAdapter,
  createMockIamAdapter,
  grantableRoles,
} from "./iam";
import { createIamAdapter } from "./factory";
import { isNotImplemented } from "./mode";

/** No latency so tests are deterministic and fast. */
const instant = { latencyMs: 0 };

/** A platform administrator's mock adapter (the development default). */
function adminAdapter() {
  return createMockIamAdapter({
    ...instant,
    callerRoles: ["platform-admin"],
    callerUsername: "devuser",
  });
}

/**
 * A *site-scoped* administrator: platform-editor strength, managing exactly
 * one Site — the profile that must never be able to grant platform-admin
 * or touch scopes beyond its own.
 */
function siteAdminAdapter() {
  return createMockIamAdapter({
    ...instant,
    callerRoles: ["platform-editor"],
    callerUsername: "alemayehu",
    manageableScopes: [
      { type: "SITE", id: 1, label: "University of Gondar (UOG_MAIN)" },
    ],
  });
}

describe("grantableRoles", () => {
  it("gives a platform administrator every role", () => {
    expect(grantableRoles(["platform-admin"])).toEqual([
      "platform-viewer",
      "platform-editor",
      "platform-admin",
    ]);
  });

  it("never lets an editor grant the platform administrator role", () => {
    const roles = grantableRoles(["platform-editor"]);
    expect(roles).toContain("platform-editor");
    expect(roles).toContain("platform-viewer");
    expect(roles).not.toContain("platform-admin");
  });

  it("gives a read-only viewer no assignable roles at all", () => {
    expect(grantableRoles(["platform-viewer"])).toEqual([]);
    expect(grantableRoles([])).toEqual([]);
    expect(grantableRoles(["something-else"])).toEqual([]);
  });
});

describe("mock adapter — caller authority", () => {
  it("offers a platform administrator the platform scope and every site/organization", async () => {
    const access = await adminAdapter().getCallerAccess();
    expect(access.username).toBe("devuser");
    expect(access.roles).toContain("platform-admin");
    expect(access.assignable_roles).toHaveLength(3);
    expect(access.manageable_scopes.some((scope) => scope.type === "PLATFORM")).toBe(true);
    expect(access.manageable_scopes.some((scope) => scope.type === "SITE")).toBe(true);
    expect(access.manageable_scopes.some((scope) => scope.type === "ORGANIZATION")).toBe(true);
  });

  it("limits a site-scoped administrator to their own scope and grantable roles", async () => {
    const access = await siteAdminAdapter().getCallerAccess();
    expect(access.assignable_roles).not.toContain("platform-admin");
    expect(access.manageable_scopes).toEqual([
      { type: "SITE", id: 1, label: "University of Gondar (UOG_MAIN)" },
    ]);
  });

  it("reports a viewer as read-only", async () => {
    const access = await createMockIamAdapter({
      ...instant,
      callerRoles: ["platform-viewer"],
      callerUsername: "sara",
    }).getCallerAccess();
    expect(access.assignable_roles).toEqual([]);
    expect(access.manageable_scopes).toEqual([]);
  });
});

describe("mock adapter — user search", () => {
  it("finds users by a case-insensitive substring of username, email or name", async () => {
    const adapter = adminAdapter();
    const byUsername = await adapter.searchUsers({ search: "SARA" });
    expect(byUsername.count).toBe(1);
    expect(byUsername.results[0].username).toBe("sara");

    const byEmail = await adapter.searchUsers({ search: "alemayehu.t@" });
    expect(byEmail.count).toBe(1);
    expect(byEmail.results[0].id).toBe("sub-0002-alemayehu");

    const byName = await adapter.searchUsers({ search: "bekele" });
    expect(byName.count).toBe(1);
  });

  it("returns every user for an empty search and reports the total count", async () => {
    const result = await adminAdapter().searchUsers();
    expect(result.count).toBe(userFixtures.length);
    expect(result.results).toHaveLength(userFixtures.length);
  });

  it("answers with an empty page when nothing matches", async () => {
    const result = await adminAdapter().searchUsers({ search: "nobody-here" });
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });
});

describe("mock adapter — create assignment", () => {
  it("grants a role within a managed scope and lists it afterwards", async () => {
    const adapter = adminAdapter();
    const created = await adapter.createAssignment({
      user_id: "sub-0003-sara",
      role: "platform-editor",
      scope_type: "SITE",
      scope_id: 2,
    });
    expect(created.data.role).toBe("platform-editor");
    expect(created.data.created_by).toBe("devuser");
    expect(created.etag).toBeTruthy();

    const list = await adapter.listAssignments({ user: "sub-0003-sara" });
    expect(list.count).toBe(2);
    expect(list.results.some((row) => row.role === "platform-editor")).toBe(true);
  });

  it("records an audit entry for every grant", async () => {
    const adapter = adminAdapter();
    const before = await adapter.listAuditEvents();
    await adapter.createAssignment({
      user_id: "sub-0004-former-staff",
      role: "platform-viewer",
      scope_type: "PLATFORM",
      scope_id: null,
    });
    const after = await adapter.listAuditEvents();
    expect(after.count).toBe(before.count + 1);
    expect(after.results[0].action).toBe("assignment.created");
  });

  it("rejects a duplicate grant with 409 conflict", async () => {
    await expect(
      adminAdapter().createAssignment({
        user_id: "sub-0001-devuser",
        role: "platform-admin",
        scope_type: "PLATFORM",
        scope_id: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("denies an unknown user with 404", async () => {
    await expect(
      adminAdapter().createAssignment({
        user_id: "sub-9999-ghost",
        role: "platform-viewer",
        scope_type: "PLATFORM",
        scope_id: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("requires a scope id for a site or organization scope (400 field error)", async () => {
    const error = await adminAdapter()
      .createAssignment({
        user_id: "sub-0003-sara",
        role: "platform-viewer",
        scope_type: "SITE",
        scope_id: null,
      })
      .catch((cause: unknown) => cause as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).fieldErrors?.scope_id).toBeTruthy();
  });

  it("denies a site-scoped administrator who tries to grant platform-admin", async () => {
    const error = await siteAdminAdapter()
      .createAssignment({
        user_id: "sub-0003-sara",
        role: "platform-admin",
        scope_type: "SITE",
        scope_id: 1,
      })
      .catch((cause: unknown) => cause as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("permission_denied");
  });

  it("denies a site-scoped administrator acting outside their scope", async () => {
    const error = await siteAdminAdapter()
      .createAssignment({
        user_id: "sub-0003-sara",
        role: "platform-viewer",
        scope_type: "SITE",
        scope_id: 2, // another site they do not manage
      })
      .catch((cause: unknown) => cause as ApiError);

    expect((error as ApiError).status).toBe(403);
  });
});

describe("mock adapter — revoke assignment", () => {
  it("removes the grant against the current ETag and records the audit entry", async () => {
    const adapter = adminAdapter();
    const detail = await adapter.getAssignment(104);
    expect(detail.etag).toBeTruthy();

    await adapter.revokeAssignment(104, detail.etag as string);

    const list = await adapter.listAssignments({ user: "sub-0003-sara" });
    expect(list.results.some((row) => row.id === 104)).toBe(false);
    const audit = await adapter.listAuditEvents();
    expect(audit.results[0].action).toBe("assignment.revoked");
  });

  it("refuses a stale ETag with 412 instead of revoking blindly", async () => {
    const adapter = adminAdapter();
    const error = await adapter
      .revokeAssignment(104, '"assignment-104-v0"')
      .catch((cause: unknown) => cause as ApiError);
    expect((error as ApiError).status).toBe(412);

    // The assignment is untouched.
    const list = await adapter.listAssignments({ user: "sub-0003-sara" });
    expect(list.results.some((row) => row.id === 104)).toBe(true);
  });

  it("denies a revocation outside the caller's managed scope", async () => {
    const error = await siteAdminAdapter()
      .revokeAssignment(101, '"assignment-101-v1"')
      .catch((cause: unknown) => cause as ApiError);
    expect((error as ApiError).status).toBe(403);
  });

  it("answers 404 for an assignment that does not exist", async () => {
    await expect(
      adminAdapter().revokeAssignment(999_999, '"anything"'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("mock adapter — effective permissions and audit", () => {
  it("reports the backend-shaped summary for a known user", async () => {
    const access = await adminAdapter().getEffectiveAccess("sub-0001-devuser");
    expect(access.username).toBe("devuser");
    expect(access.permissions).toHaveLength(1);
    expect(access.permissions[0].role).toBe("platform-admin");
    expect(access.permissions[0].scope_label).toBe("Whole platform");
    expect(access.permissions[0].permissions).toContain("access.manage");
  });

  it("answers 404 for an unknown subject", async () => {
    await expect(
      adminAdapter().getEffectiveAccess("sub-404-not-here"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("serves the append-only audit trail newest first", async () => {
    const audit = await adminAdapter().listAuditEvents();
    expect(audit.count).toBe(auditEventFixtures.length);
    expect(audit.results[0].id).toBeGreaterThanOrEqual(
      audit.results[audit.results.length - 1].id,
    );
    expect(audit.results.every((row) => row.entity_type === "UserAssignment")).toBe(true);
  });
});

describe("live adapter", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("converts a missing collection endpoint into an explicit 501 (no fabricated data)", async () => {
    const fetchFn = vi.fn(async () =>
      new Response("<html>404 Not Found</html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    const adapter = createLiveIamAdapter({
      baseUrl: "http://backend:8000/api",
      fetchFn,
    });

    const error = await adapter.searchUsers({ search: "x" }).catch(
      (cause: unknown) => cause as ApiError,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(501);
    expect(isNotImplemented(error)).toBe(true);
    expect((error as ApiError).message).toMatch(/P2-IAM-004/);
    // The error explains the dependency instead of inventing results.
    expect((error as ApiError).message).toMatch(/nothing is substituted/);
  });

  it("keeps a real detail 404 as 404 (unknown user, once the API ships)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: { code: "not_found", message: "No such user." }, request_id: "req-9" },
        404,
      ),
    ) as unknown as typeof fetch;

    const adapter = createLiveIamAdapter({
      baseUrl: "http://backend:8000/api",
      fetchFn,
    });
    const error = await adapter.getEffectiveAccess("missing").catch(
      (cause: unknown) => cause as ApiError,
    );
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).requestId).toBe("req-9");
  });

  it("passes backend permission denials through verbatim (403)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: { code: "permission_denied", message: "You may not grant this role." },
          request_id: "req-7",
        },
        403,
      ),
    ) as unknown as typeof fetch;

    const adapter = createLiveIamAdapter({
      baseUrl: "http://backend:8000/api",
      fetchFn,
    });
    const error = await adapter
      .createAssignment({
        user_id: "sub-0003-sara",
        role: "platform-admin",
        scope_type: "PLATFORM",
        scope_id: null,
      })
      .catch((cause: unknown) => cause as ApiError);

    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("You may not grant this role.");
  });

  it("sends the access token as a header only, and revokes conditionally", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return init.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }) as unknown as typeof fetch;

    const adapter = createLiveIamAdapter({
      baseUrl: "http://backend:8000/api",
      accessToken: "secret-token",
      fetchFn,
    });

    await adapter.searchUsers({ search: "sara" });
    expect(calls[0].url).toBe("http://backend:8000/api/v1/users/?search=sara");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");

    await adapter.revokeAssignment(7, '"etag-7"');
    const deleteCall = calls.find((call) => call.init.method === "DELETE");
    expect(deleteCall?.url).toBe("http://backend:8000/api/v1/assignments/7/");
    const deleteHeaders = deleteCall?.init.headers as Record<string, string>;
    expect(deleteHeaders["If-Match"]).toBe('"etag-7"');
  });

  it("never places the token in the URL or the error message", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: { code: "conflict", message: "Already assigned." }, request_id: "req-1" },
        409,
      ),
    ) as unknown as typeof fetch;

    const adapter = createLiveIamAdapter({
      baseUrl: "http://backend:8000/api",
      accessToken: "secret-token",
      fetchFn,
    });
    const error = await adapter
      .createAssignment({
        user_id: "sub-0003-sara",
        role: "platform-viewer",
        scope_type: "PLATFORM",
        scope_id: null,
      })
      .catch((cause: unknown) => cause as ApiError);

    expect(JSON.stringify((error as ApiError).details ?? null)).not.toContain(
      "secret-token",
    );
    expect((error as ApiError).message).not.toContain("secret-token");
  });
});

describe("createIamAdapter factory", () => {
  it("builds the live adapter in live mode, without fixture data", async () => {
    const adapter = createIamAdapter({ mode: "live", baseUrl: "/api" });
    await expect(adapter.searchUsers()).rejects.toBeInstanceOf(ApiError);
  });

  it("builds the mock adapter in mock mode with the caller's roles", async () => {
    const adapter = createIamAdapter({
      mode: "mock",
      mockLatencyMs: 0,
      callerRoles: ["platform-viewer"],
      callerUsername: "sara",
    });
    const access = await adapter.getCallerAccess();
    expect(access.username).toBe("sara");
    expect(access.assignable_roles).toEqual([]);
  });
});
