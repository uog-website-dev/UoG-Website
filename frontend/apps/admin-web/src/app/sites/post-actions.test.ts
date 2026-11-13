import { expect, it, vi } from "vitest";
const { get } = vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@uog/api-client",async importOriginal=>({...await importOriginal<typeof import("@uog/api-client")>(),createApiClient:()=>({get})}));
vi.mock("@/access-token",()=>({getAccessToken:async()=>"test-server-token"}));
import { loadSiteTaxonomy } from "./post-actions";

it("loads eligible taxonomy beyond the first page and filters foreign or inactive entries",async()=>{
  const term={id:"one",site:11,name:"News",is_active:true};
  get.mockResolvedValueOnce({next:"/ignored-next-url",results:[term,{...term,id:"foreign",site:22},{...term,id:"inactive",is_active:false}]});
  get.mockResolvedValueOnce({next:null,results:[{...term,id:"last-page"}]});
  const result=await loadSiteTaxonomy(11,"categories");
  expect(result).toEqual({ok:true,data:[term,{...term,id:"last-page"}]});
  expect(get).toHaveBeenNthCalledWith(1,expect.stringContaining("is_active=true&page_size=100&ordering=name&page=1"));
  expect(get).toHaveBeenNthCalledWith(2,expect.stringContaining("/sites/11/categories/"));
  expect(get).toHaveBeenNthCalledWith(2,expect.stringContaining("page=2"));
});
