// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const { token } = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@/access-token", () => ({ getAccessToken: token }));
import { GET } from "./route";
const id="00000000-0000-4000-8000-000000000001";
beforeEach(() => token.mockResolvedValue("private-token"));
afterEach(() => vi.restoreAllMocks());
describe("Private thumbnail proxy", () => {
  it("keeps tokens server-side and responses uncached", async () => {
    const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("webp",{headers:{"Content-Type":"image/webp"}}));
    const response=await GET(new NextRequest("http://localhost/admin/sites/11/media/asset/image?variant=thumbnail"),{params:Promise.resolve({id:"11",assetId:id})});
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/sites/11/assets/${id}/image/?variant=thumbnail`);
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string,string>).Authorization).toBe("Bearer private-token");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Authorization")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });
  it("does not forward an anonymous request", async () => {
    const fetch=vi.spyOn(globalThis,"fetch"); token.mockResolvedValue(null);
    const response=await GET(new NextRequest("http://localhost/"),{params:Promise.resolve({id:"11",assetId:id})});
    expect(response.status).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
});
