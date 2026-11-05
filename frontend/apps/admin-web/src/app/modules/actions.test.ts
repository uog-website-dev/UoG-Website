import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, createApiClient } = vi.hoisted(() => {
  const api = { get: vi.fn(), post: vi.fn() };
  return { api, createApiClient: vi.fn(() => api) };
});

vi.mock("@uog/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uog/api-client")>()),
  createApiClient,
}));
vi.mock("@/access-token", () => ({ getAccessToken: vi.fn(async () => "server-token") }));

import { applyModuleOperation, listModuleOperations, listSiteModuleActivation, previewModuleOperation } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("module management actions", () => {
  it("lists Site activation with only the supplied filters", async () => {
    api.get.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    await listSiteModuleActivation({ organization: 6, include_descendants: false, module: "POSTS", activation: "ENABLED", page: 2 });
    expect(api.get).toHaveBeenCalledWith("/v1/site-modules/?organization=6&module=POSTS&activation=ENABLED&page=2");
    expect(createApiClient).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "server-token" }));
  });

  it("posts the preview request unchanged", async () => {
    api.post.mockResolvedValue({ preview_token: "t" });
    const request = { action: "ENABLE" as const, modules: ["POSTS"], scope: { type: "ALL" as const } };
    await expect(previewModuleOperation(request)).resolves.toEqual({ ok: true, data: { preview_token: "t" } });
    expect(api.post).toHaveBeenCalledWith("/v1/site-modules/bulk-preview/", request);
  });

  it("sends the Idempotency-Key header and a longer timeout on apply", async () => {
    api.post.mockResolvedValue({ replayed: false });
    await applyModuleOperation({ previewToken: "t", idempotencyKey: "key-1", reason: "Pilot", confirmation: "" });
    expect(api.post).toHaveBeenCalledWith(
      "/v1/site-modules/bulk-apply/",
      { preview_token: "t", reason: "Pilot", confirmation: "" },
      { headers: { "Idempotency-Key": "key-1" } },
    );
    expect(createApiClient).toHaveBeenLastCalledWith(expect.objectContaining({ timeoutMs: 60_000 }));
  });

  it("returns a clone-safe failure instead of throwing", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    const result = await listModuleOperations({ action: "DISABLE" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ message: "offline", status: 0 }) });
    expect(api.get).toHaveBeenCalledWith("/v1/site-modules/operations/?action=DISABLE");
  });
});
