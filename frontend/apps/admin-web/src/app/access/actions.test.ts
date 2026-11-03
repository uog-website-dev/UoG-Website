import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    getDetailed: vi.fn(),
    postDetailed: vi.fn(),
  },
}));

vi.mock("@uog/api-client", async () => {
  const actual = await vi.importActual<typeof import("@uog/api-client")>("@uog/api-client");
  return { ...actual, createApiClient: vi.fn(() => api) };
});

vi.mock("@/access-token", () => ({
  getAccessToken: vi.fn(async () => "server-token"),
}));

import { ApiError } from "@uog/api-client";

import { getAccessToken } from "@/access-token";

import { getAccessControlData, searchUsers } from "./actions";

const editor = {
  id: 4,
  code: "editor",
  name: "Editor",
  description: "Create and edit content.",
  is_system: true,
  is_active: true,
  permissions: ["content.pages.create", "content.pages.update", "menu.write"],
};

function detail(data: unknown, requestId = "req-ok") {
  return { data, etag: null, requestId, status: 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessToken).mockResolvedValue("server-token");
});

describe("access control loading", () => {
  it("returns registered roles and does not invent grants for a successful empty assignment page", async () => {
    api.getDetailed.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/authorization/permissions/")) return detail([]);
      if (path.startsWith("/v1/authorization/roles/")) {
        return detail({ count: 1, next: null, previous: null, results: [editor] });
      }
      if (path.startsWith("/v1/authorization/assignments/")) {
        return detail({ count: 0, next: null, previous: null, results: [] });
      }
      if (path === "/v1/authorization/me/permissions/") {
        return detail({ user: 3, organization: null, site: null, permissions: ["platform.users.view"] });
      }
      throw new Error(path);
    });

    const result = await getAccessControlData({ scope: "PLATFORM" });

    expect(result.roles).toEqual({ status: "ready", data: [editor] });
    expect(result.assignments).toEqual({ status: "ready", data: [] });
    expect(result.effective).toEqual({ status: "ready", data: ["platform.users.view"] });
    expect(result.callerUserId).toBe(3);
    expect(api.getDetailed.mock.calls.some((call) => String(call[0]).includes("access_token"))).toBe(false);
  });

  it("keeps a backend denial as an error with its correlation id", async () => {
    api.getDetailed.mockRejectedValue(new ApiError(
      "You can only inspect users in a scope you are authorized to view.",
      403,
      { code: "permission_denied", requestId: "req-denied" },
    ));

    const result = await getAccessControlData();

    expect(result.roles).toEqual({
      status: "error",
      error: expect.objectContaining({
        status: 403,
        code: "permission_denied",
        requestId: "req-denied",
      }),
    });
    expect(result.roles.status === "error" ? result.roles.error.message : "").toContain("authorized to view");
    expect(result.assignments.status).toBe("error");
  });

  it("rejects a successful payload that is missing its result list", async () => {
    api.getDetailed.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/authorization/roles/")) return detail({ count: 7 }, "req-malformed");
      if (path.startsWith("/v1/authorization/permissions/")) return detail([]);
      if (path.startsWith("/v1/authorization/assignments/")) {
        return detail({ count: 0, next: null, previous: null, results: [] });
      }
      return detail({ user: 3, organization: null, site: null, permissions: [] });
    });

    const result = await getAccessControlData();

    expect(result.roles).toEqual({
      status: "error",
      error: expect.objectContaining({ code: "invalid_response", requestId: "req-malformed" }),
    });
  });

  it("reports a missing session instead of an empty catalog", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);

    const result = await getAccessControlData();

    expect(result.permissions).toEqual({
      status: "error",
      error: expect.objectContaining({ status: 401, code: "not_authenticated" }),
    });
    expect(api.getDetailed).not.toHaveBeenCalled();
  });

  it("does not turn an unsupported lookup into an empty page", async () => {
    const result = await searchUsers({ search: "devuser" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toContain("not provided");
    }
  });
});
