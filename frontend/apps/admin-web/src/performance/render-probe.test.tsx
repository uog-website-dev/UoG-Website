import {render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {RenderProbe} from "./render-probe";
afterEach(()=>{vi.unstubAllEnvs();delete window.__uogRenderProfiles;});
it("does not collect component telemetry in ordinary production configuration",()=>{
 vi.stubEnv('NEXT_PUBLIC_RENDER_PROFILING','0');render(<RenderProbe id="shell"><p>Visible content</p></RenderProbe>);
 expect(screen.getByText('Visible content')).toBeTruthy();expect(window.__uogRenderProfiles).toBeUndefined();
});
it("records bounded numeric component timing without props or content",()=>{
 vi.stubEnv('NEXT_PUBLIC_RENDER_PROFILING','1');render(<RenderProbe id="shell"><p>Private draft must stay out of traces</p></RenderProbe>);
 expect(window.__uogRenderProfiles?.length).toBeGreaterThan(0);expect(JSON.stringify(window.__uogRenderProfiles)).not.toContain('Private draft');expect(window.__uogRenderProfiles?.[0]?.id).toBe('shell');
});
