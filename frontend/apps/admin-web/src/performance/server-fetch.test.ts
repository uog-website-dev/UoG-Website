import {afterEach,beforeEach,it,expect,vi} from "vitest";
const incoming=vi.hoisted(()=>vi.fn());vi.mock("next/headers",()=>({headers:incoming}));
import {serverApiFetch,traceIdentifier} from "./server-fetch";
const nav="11111111-1111-4111-8111-111111111111",parent="22222222-2222-4222-8222-222222222222";
let transport:ReturnType<typeof vi.fn>;
beforeEach(()=>{vi.stubEnv("PERF_INSTRUMENTATION_ENABLED","1");transport=vi.fn().mockResolvedValue(new Response('{}',{headers:{'X-Request-ID':parent,'X-SQL-Count':'3','X-SQL-Time-Ms':'4.2'}}));vi.stubGlobal("fetch",transport);incoming.mockResolvedValue(new Headers({'X-Navigation-ID':nav,'X-Request-ID':parent}));});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('propagates navigation and parent identity while preserving authentication and logs aggregates only',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 await serverApiFetch('http://backend/api/private?secret=DO_NOT_LOG',{headers:{Authorization:'Bearer SECRET'},method:'POST',body:'PRIVATE_BODY'});
 const headers=transport.mock.calls[0][1].headers as Headers;expect(headers.get('x-navigation-id')).toBe(nav);expect(headers.get('x-parent-request-id')).toBe(parent);expect(headers.get('authorization')).toBe('Bearer SECRET');
 const record=JSON.parse(log.mock.calls[0][0]);expect(record.sql_count).toBe(3);expect(record.sql_ms).toBe(4.2);expect(record.request_id).toBe(parent);
 expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|DO_NOT_LOG|PRIVATE_BODY|backend/);
});
it('is a transparent transport when disabled',async()=>{
 vi.stubEnv('PERF_INSTRUMENTATION_ENABLED','0');const init={method:'GET'};const log=vi.spyOn(console,'info');await serverApiFetch('/api',init);expect(transport).toHaveBeenCalledWith('/api',init);expect(log).not.toHaveBeenCalled();
});
it('rejects malformed incoming identifiers and does not log error details',async()=>{
 incoming.mockResolvedValue(new Headers({'x-navigation-id':'private-secret'}));transport.mockRejectedValue(new Error('SECRET'));const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 await expect(serverApiFetch('/api')).rejects.toThrow('SECRET');expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');expect(traceIdentifier('injected')).toBeNull();
});
