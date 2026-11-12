// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock("@/access-token", () => ({ getAccessToken }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); getAccessToken.mockResolvedValue("private-server-token"); });
afterEach(() => vi.restoreAllMocks());
function request(origin = "http://localhost", key = "retry-key") {
  return new NextRequest("http://localhost/admin/sites/11/media-upload?filename=campus.png", {
    method: "POST", headers: { origin, host: "localhost", "content-length": "3", "idempotency-key": key }, body: "png",
  });
}
describe("private upload proxy", () => {
  it("rejects cross-origin and anonymous requests before forwarding bytes", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect((await POST(request("http://foreign.example"), { params: Promise.resolve({ id: "11" }) })).status).toBe(403);
    getAccessToken.mockResolvedValue(null);
    expect((await POST(request(), { params: Promise.resolve({ id: "11" }) })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("streams to the scoped backend with server credentials and preserves retry identity", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "asset-id", status: "PENDING", processing_state: "PROCESSING" }), { status: 202 }));
    const forwarded = request();
    forwarded.headers.set("origin", "http://localhost:8080");
    forwarded.headers.set("x-forwarded-host", "localhost:8080");
    const response = await POST(forwarded, { params: Promise.resolve({ id: "11" }) });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: "asset-id", status: "PENDING", processing_state: "PROCESSING" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/sites/11/assets/upload/?filename=campus.png");
    const headers = init?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer private-server-token");
    expect(headers.get("idempotency-key")).toBe("retry-key");
    expect(init?.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get("authorization")).toBeNull();
  });
});
