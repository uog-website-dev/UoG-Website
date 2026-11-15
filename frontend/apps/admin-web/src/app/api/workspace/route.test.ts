import {beforeEach, describe, expect, it, vi} from "vitest";
const token = vi.fn();
const upstream = vi.fn();
vi.mock("@/access-token", () => ({getAccessToken: () => token()}));
vi.mock("@/performance/server-fetch", () => ({serverApiFetch: (...args: unknown[]) => upstream(...args)}));
import {GET} from "./route";
import {GET as discovery} from "./sites/route";
beforeEach(() => {vi.clearAllMocks(); token.mockResolvedValue("private-token"); upstream.mockResolvedValue(Response.json({schemaVersion: 1, site: {id: 11}}, {headers: {ETag: '"v1"'}}));});
describe("workspace proxy", () => {
  it("makes exactly one authenticated upstream call and forwards the private version", async () => {
    const response = await GET(new Request("http://localhost/admin/api/workspace?site=11"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("ETag")).toBe('"v1"');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledWith(expect.stringMatching(/\/api\/workspace\/\?site=11$/), expect.objectContaining({cache: "no-store", headers: {Authorization: "Bearer private-token"}}));
  });
  it.each(["site=0", "site=abc", "site=", "site=9007199254740993", "site=11&site=22", "organization=1"])("rejects ambiguous query %s", async query => {
    expect((await GET(new Request(`http://localhost/admin/api/workspace?${query}`))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("requires a session", async () => {token.mockResolvedValue(null); expect((await GET(new Request("http://localhost/admin/api/workspace"))).status).toBe(401); expect(upstream).not.toHaveBeenCalled();});
  it("preserves denial and handles service failure without an empty success", async () => {
    upstream.mockResolvedValueOnce(Response.json({detail: "Not found"}, {status: 404}));
    expect((await GET(new Request("http://localhost/admin/api/workspace?site=22"))).status).toBe(404);
    upstream.mockRejectedValueOnce(new Error("private exception details"));
    const result = await GET(new Request("http://localhost/admin/api/workspace?site=11"));
    expect(result.status).toBe(502); expect(await result.json()).toEqual({error: "workspace_unavailable"});
  });
  it("proxies paginated search separately", async () => {
    await discovery(new Request("http://localhost/admin/api/workspace/sites?search=college&page=2&page_size=20"));
    expect(upstream.mock.calls[0][0]).toContain("/workspace/sites/?search=college&page=2&page_size=20");
    expect((await discovery(new Request("http://localhost/admin/api/workspace/sites?site=22"))).status).toBe(400);
  });
});
