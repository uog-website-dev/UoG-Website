import {render,fireEvent,waitFor} from "@testing-library/react";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {NavigationTiming} from "./navigation-timing";
const id="11111111-1111-4111-8111-111111111111";
import {performance as clock} from "node:perf_hooks";
let transport:ReturnType<typeof vi.fn>;
const measures=()=>clock.getEntriesByName(`uog:navigation:${id}`,"measure");
beforeEach(()=>{
 sessionStorage.clear();clock.clearMarks();clock.clearMeasures();history.replaceState(null,'','/admin');
 vi.stubGlobal('performance',clock);transport=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',transport);
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear();clock.clearMarks();clock.clearMeasures();});
it('marks a navigation and propagates correlation only to same-origin non-auth fetches',async()=>{
 render(<NavigationTiming/>);fireEvent(window,new CustomEvent('uog:navigation:start',{detail:{id}}));
 await window.fetch('/admin/api/workspace/');const init=transport.mock.calls[0][1];expect(init.headers.get('X-Navigation-ID')).toBe(id);expect(init.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
 await window.fetch('/admin/api/auth/session');await window.fetch('https://external.example/data');expect(transport.mock.calls[1][1]).toBeUndefined();expect(transport.mock.calls[2][1]).toBeUndefined();
 fireEvent(window,new CustomEvent('uog:navigation:usable',{detail:{id}}));expect(measures()).toHaveLength(1);expect(sessionStorage.getItem('uog:performance:active-navigation')).toBeNull();
});
it('restores a remounted/reloaded development navigation and labels document-local marks',()=>{
 const first=render(<NavigationTiming/>);fireEvent(window,new CustomEvent('uog:navigation:start',{detail:{id}}));first.unmount();clock.clearMarks();clock.clearMeasures();
 render(<NavigationTiming/>);fireEvent(window,new CustomEvent('uog:navigation:usable',{detail:{id}}));const measure=measures()[0] as PerformanceMeasure;expect(measure?.detail).toMatchObject({scope:'resumed-document'});
});
it('does not declare the former Site usable when a switch has changed the URL',async()=>{
 history.replaceState(null,'','/admin/sites/12/admin');
 const Tree=({site}:{site:number})=><><NavigationTiming/><div data-perf-navigation-ready="true" ref={el=>{if(el)el.getBoundingClientRect=()=>({width:100} as DOMRect);}}/><div data-perf-site-id={site}><div data-perf-section="dashboard"/></div></>;
 const view=render(<Tree site={11}/>);fireEvent(window,new CustomEvent('uog:navigation:start',{detail:{id,target:'/admin/sites/12/admin'}}));view.rerender(<Tree site={11}/>);expect(measures()).toHaveLength(0);
 view.rerender(<Tree site={12}/>);await waitFor(()=>expect(measures().length).toBeGreaterThan(0));
});
