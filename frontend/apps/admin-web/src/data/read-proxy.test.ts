// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const {token,upstream}=vi.hoisted(()=>({token:vi.fn(),upstream:vi.fn()}));
vi.mock("@/access-token",()=>({getAccessToken:token}));
vi.mock("@/performance/server-fetch",()=>({serverApiFetch:upstream}));
import {readProxy} from "./read-proxy";
const request=(query="site=11&resource=pages",init:RequestInit={})=>new Request(`http://localhost/admin/api/reads?${query}`,init);
beforeEach(()=>{vi.clearAllMocks();token.mockResolvedValue("private-access-token");upstream.mockResolvedValue(Response.json({count:1,results:[{site:11,id:"page"}]}));});
afterEach(()=>vi.unstubAllEnvs());
it("uses one fixed GET, server-side bearer, private JSON and trace IDs without reflecting tokens or cookies",async()=>{
  const response=await readProxy(request());expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
  const [url,init]=upstream.mock.calls[0]!;expect(url).toContain("/v1/sites/11/pages/");expect(init.method).toBe("GET");expect(init.redirect).toBe("error");expect(init.headers.Authorization).toBe("Bearer private-access-token");expect(init.cache).toBe("no-store");expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(await response.text()).not.toMatch(/private-access-token|refresh_token|Authorization/);expect(response.headers.get("set-cookie")).toBeNull();
});
it("uses distinct upstream IDs when parallel reads share a root ID",async()=>{
  const root="b83ec7cb-89bd-4fc8-a0c2-c799439949eb";
  await Promise.all([readProxy(request(undefined,{headers:{"x-request-id":root}})),readProxy(request(undefined,{headers:{"x-request-id":root}}))]);
  const ids=upstream.mock.calls.map(([,init])=>init.headers["X-Request-ID"]);expect(new Set(ids).size).toBe(2);expect(ids).not.toContain(root);
});
it("negotiates gzip for JSON without mixing credentials into the compressed body",async()=>{
  const response=await readProxy(request(undefined,{headers:{"Accept-Encoding":"gzip, deflate, br"}}));
  expect(response.headers.get("content-encoding")).toBe("gzip");expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
  const decoded=await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  expect(JSON.parse(decoded)).toMatchObject({results:[{site:11}]});expect(decoded).not.toContain("private-access-token");
});
it.each(["br", "gzip;q=0, br"])("does not send unaccepted gzip for %s",async encoding=>{
  const response=await readProxy(request(undefined,{headers:{"Accept-Encoding":encoding}}));expect(response.headers.get("content-encoding")).toBeNull();expect((await response.json()).count).toBe(1);
});
it.each(["site=11&resource=http://evil.test","site=11&resource=__proto__","site=11&site=22&resource=pages","site=0&resource=pages","site=9007199254740992&resource=posts","site=11&resource=pages&url=http://evil.test","site=11&resource=pages&site_id=22"])("rejects unsafe target/query %s before auth or upstream",async query=>{
  expect((await readProxy(request(query))).status).toBe(400);expect(upstream).not.toHaveBeenCalled();expect(token).not.toHaveBeenCalled();
});
it("denies anonymous, cross-origin and write attempts without an upstream request",async()=>{
  token.mockResolvedValue(null);expect((await readProxy(request())).status).toBe(401);
  expect((await readProxy(request(undefined,{headers:{Origin:"https://evil.test"}}))).status).toBe(403);
  expect((await readProxy(request(undefined,{headers:{"Sec-Fetch-Site":"cross-site"}}))).status).toBe(403);
  expect((await readProxy(request(undefined,{method:"POST"}))).status).toBe(405);expect(upstream).not.toHaveBeenCalled();
});
it("preserves field-addressed backend errors and rejects foreign or malformed success",async()=>{
  upstream.mockResolvedValue(Response.json({error:{code:"validation_error",details:{status:["Invalid."]}}},{status:400}));expect((await readProxy(request())).status).toBe(400);
  for(const body of [{count:1,results:[{site:22,id:"foreign"}]},{site:22},{results:null}]) {upstream.mockResolvedValue(Response.json(body));expect((await readProxy(request())).status).toBe(502);}
  upstream.mockResolvedValue(new Response("HTML stack trace",{status:500}));const result=await readProxy(request());expect(result.status).toBe(502);expect(await result.text()).not.toContain("stack trace");
});
it("maps session/network failures generically and propagates cancellation",async()=>{
  token.mockRejectedValueOnce(new Error("private-access-token"));expect((await readProxy(request())).status).toBe(503);
  upstream.mockRejectedValueOnce(new Error("private-access-token"));let result=await readProxy(request());expect(result.status).toBe(502);expect(await result.text()).not.toContain("private-access-token");
  const controller=new AbortController();upstream.mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new Error("aborted")))));
  const pending=readProxy(request(undefined,{signal:controller.signal}));await vi.waitFor(()=>expect(upstream).toHaveBeenCalledTimes(2));controller.abort();result=await pending;expect(result.status).toBe(499);
});
it("bounds upstream timeout even when the request has its own signal",async()=>{
  vi.useFakeTimers();try {
    // Node's AbortSignal.timeout uses native timers; inject a deterministic signal.
    const controller=new AbortController();const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(controller.signal);
    upstream.mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new Error("timeout")))));
    const pending=readProxy(request());await Promise.resolve();await Promise.resolve();controller.abort();expect((await pending).status).toBe(504);expect(timeout).toHaveBeenCalledWith(10_000);timeout.mockRestore();
  } finally {vi.useRealTimers();}
});
