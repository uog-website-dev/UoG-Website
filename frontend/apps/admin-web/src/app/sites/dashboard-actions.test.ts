import {beforeEach, expect, it, vi} from "vitest";
const {get} = vi.hoisted(() => ({get:vi.fn()}));
vi.mock("@uog/api-client",async original=>({...await original<typeof import("@uog/api-client")>(),createApiClient:()=>({get})}));
vi.mock("@/access-token",()=>({getAccessToken:async()=>"server-only-token"}));
import {getSiteDashboardSummary, getSiteDashboardActivity} from "./dashboard-actions";
const body=()=>({schema_version:1,site:11,generated_at:new Date().toISOString(),expires_at:new Date(Date.now()+15000).toISOString(),partial:false,cache:{hit:false,available:true,ttl_seconds:15},sections:{pages:{status:"ready",counts:{total:1,DRAFT:1,IN_REVIEW:0,APPROVED:0,PUBLISHED:0,UNPUBLISHED:0,ARCHIVED:0}}}});
beforeEach(()=>vi.clearAllMocks());
it("uses the scoped aggregate endpoint without returning credentials",async()=>{
  get.mockResolvedValue(body());const result=await getSiteDashboardSummary(11);expect(result.ok).toBe(true);expect(get).toHaveBeenCalledWith("/workspace/dashboard/?site=11");expect(JSON.stringify(result)).not.toContain("server-only-token");
});
it.each([()=>({...body(),site:22}),()=>({...body(),schema_version:99}),()=>({...body(),sections:{pages:{status:"ready",counts:{total:-1}}}})])("rejects a foreign or invalid summary instead of caching it",async invalid=>{get.mockResolvedValue(invalid());expect((await getSiteDashboardSummary(11)).ok).toBe(false);});
it("bounds and validates the separate recent activity contract",async()=>{
  get.mockResolvedValue({site:11,generated_at:new Date().toISOString(),results:[{id:"7ce57266-1497-477c-8725-d8e67d02cf38",kind:"posts",title:"<script>escaped label</script>",status:"DRAFT",updated_at:new Date().toISOString()}]});
  expect((await getSiteDashboardActivity(11)).ok).toBe(true);expect(get).toHaveBeenCalledWith("/workspace/dashboard/activity/?site=11");
  get.mockResolvedValue({site:11,generated_at:new Date().toISOString(),results:Array(6).fill({})});expect((await getSiteDashboardActivity(11)).ok).toBe(false);
});
