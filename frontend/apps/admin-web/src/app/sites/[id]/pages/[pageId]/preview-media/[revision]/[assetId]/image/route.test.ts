import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const {token}=vi.hoisted(()=>({token:vi.fn()}));
vi.mock("@/access-token",()=>({getAccessToken:token}));
import {GET} from "./route";
const pageId="11111111-1111-4111-8111-111111111111",assetId="22222222-2222-4222-8222-222222222222";
const params={id:"11",pageId,assetId,revision:"8"};
beforeEach(()=>{vi.clearAllMocks();token.mockResolvedValue("test-token");});
afterEach(()=>vi.restoreAllMocks());
it("proxies only the selected scoped revision without caching or exposing credentials",async()=>{
 const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"image/webp"}}));
 const result=await GET(new NextRequest("http://localhost/image?variant=thumbnail"),{params:Promise.resolve(params)});
 expect(send).toHaveBeenCalledWith(expect.stringContaining(`/v1/sites/11/pages/${pageId}/preview/?revision=8&asset_id=${assetId}&variant=thumbnail`),expect.objectContaining({cache:"no-store",headers:{Authorization:"Bearer test-token"}}));
 expect(result.status).toBe(200);expect(result.headers.get("Cache-Control")).toBe("private, no-store");
 expect(result.headers.get("Vary")).toContain("Cookie");expect(result.headers.has("Authorization")).toBe(false);
});
it("keeps anonymous and failed responses uncached",async()=>{
 const send=vi.spyOn(globalThis,"fetch");token.mockResolvedValue(null);
 const denied=await GET(new NextRequest("http://localhost/image"),{params:Promise.resolve(params)});
 expect(denied.status).toBe(401);expect(denied.headers.get("Cache-Control")).toContain("no-store");expect(send).not.toHaveBeenCalled();
 token.mockResolvedValue("test-token");send.mockRejectedValue(new Error("Storage unavailable"));
 const failed=await GET(new NextRequest("http://localhost/image"),{params:Promise.resolve(params)});
 expect(failed.status).toBe(503);expect(failed.headers.get("Cache-Control")).toContain("no-store");
});
