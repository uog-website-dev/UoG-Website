import {act, fireEvent, render, screen, waitFor} from "@/test/render";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {WorkspaceProvider, refreshWorkspace, useWorkspace} from "@/workspace";
import {WorkspaceSwitcher} from "@/workspace-switcher";
import {useState} from "react";

const pathname = vi.fn(() => "/sites/1/admin");
const push = vi.fn();
vi.mock("next/navigation", () => ({usePathname: () => pathname(), useRouter: () => ({push})}));
vi.mock("@/session-watch", () => ({signInAgainIfExpired: vi.fn()}));
const fixture = (id: number) => ({schemaVersion: 1, version: `version-${id}`, platformPermissions: [], site: {id, name: `Site ${id}`, code: `SITE${id}`, status: "ACTIVE", organization: {id: 1, name: "University"}, defaultLanguage: "en-us", enabledLanguages: ["en-us"], primaryDomain: null, homepageId: null, permissions: ["sites.view"], enabledModuleCodes: ["PAGES"]}});
function Consumer({label}: {label: string}) {
  const id = Number(pathname().match(/sites\/(\d+)/)?.[1]);
  const state = useWorkspace(id);
  return <div data-testid={label}>{state.status === "ready" ? state.data.site?.name : state.status}</div>;
}
function Switcher() {return <WorkspaceSwitcher state={useWorkspace(1)}/>;}
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {pathname.mockReturnValue("/sites/1/admin"); request = vi.fn(async () => Response.json(fixture(1))); vi.stubGlobal("fetch", request); push.mockReset();});
afterEach(() => vi.unstubAllGlobals());

it("shares one bootstrap across simultaneous consumers and same-Site sections", async () => {
  const view = render(<WorkspaceProvider><Consumer label="rail"/><Consumer label="layout"/></WorkspaceProvider>);
  await waitFor(() => expect(screen.getByTestId("layout").textContent).toBe("Site 1"));
  expect(screen.getByTestId("rail").textContent).toBe("Site 1");
  expect(request).toHaveBeenCalledTimes(1);
  pathname.mockReturnValue("/sites/1/admin/posts");
  view.rerender(<WorkspaceProvider><Consumer label="rail"/><Consumer label="layout"/></WorkspaceProvider>);
  expect(request).toHaveBeenCalledTimes(1);
});

it("clears old Site immediately and ignores a late response even if transport ignores abort", async () => {
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  const view = render(<WorkspaceProvider><Consumer label="context"/></WorkspaceProvider>);
  pathname.mockReturnValue("/sites/2/admin");
  request.mockResolvedValueOnce(Response.json(fixture(2)));
  view.rerender(<WorkspaceProvider><Consumer label="context"/></WorkspaceProvider>);
  expect(screen.getByTestId("context").textContent).toBe("loading");
  await waitFor(() => expect(screen.getByTestId("context").textContent).toBe("Site 2"));
  await act(async () => release(Response.json(fixture(1))));
  expect(screen.getByTestId("context").textContent).toBe("Site 2");
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
});

it("fails closed for a mismatched/version-invalid response and recovers explicitly", async () => {
  request.mockResolvedValueOnce(Response.json({...fixture(2), schemaVersion: 99}));
  render(<WorkspaceProvider><Consumer label="context"/></WorkspaceProvider>);
  await waitFor(() => expect(screen.getByTestId("context").textContent).toBe("error"));
  act(() => refreshWorkspace());
  await waitFor(() => expect(screen.getByTestId("context").textContent).toBe("Site 1"));
  request.mockResolvedValueOnce(Response.json({detail: "Not found"}, {status: 404}));
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByTestId("context").textContent).toBe("error"));
});

it("keeps an unsaved editor mounted during successful same-Site revalidation", async () => {
  function Editor() {
    const state = useWorkspace(1);
    const [text, setText] = useState("");
    return state.status === "ready" ? <input aria-label="Draft" value={text} onChange={event => setText(event.target.value)}/> : <span>Waiting</span>;
  }
  render(<WorkspaceProvider><Editor/></WorkspaceProvider>);
  fireEvent.change(await screen.findByRole("textbox", {name: "Draft"}), {target: {value: "Unsaved article"}});
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  fireEvent.focus(window);
  expect(screen.getByRole("textbox", {name: "Draft"})).toHaveProperty("value", "Unsaved article");
  await act(async () => release(Response.json(fixture(1))));
  expect(screen.getByRole("textbox", {name: "Draft"})).toHaveProperty("value", "Unsaved article");
});

it("loads discovery only on open, pages explicitly and rejects stale search results", async () => {
  request.mockImplementation(async (url: string) => url.includes("/sites/?") ? Response.json({count: 21, results: [{id: 2, name: "Medicine"}]}) : Response.json(fixture(1)));
  render(<WorkspaceProvider><Switcher/></WorkspaceProvider>);
  const button = screen.getByRole("button", {name: "Workspace"});
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  await screen.findByRole("button", {name: "Medicine"});
  fireEvent.click(screen.getByRole("button", {name: "Next Sites"}));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.stringContaining("page=2"), expect.anything()));
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  fireEvent.change(screen.getByRole("textbox", {name: "Search Sites"}), {target: {value: "slow"}});
  await waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.stringContaining("search=slow"), expect.anything()));
  request.mockResolvedValueOnce(Response.json({count: 1, results: [{id: 3, name: "Informatics"}]}));
  fireEvent.change(screen.getByRole("textbox", {name: "Search Sites"}), {target: {value: "fast"}});
  await screen.findByRole("button", {name: "Informatics"});
  await act(async () => release(Response.json({count: 1, results: [{id: 2, name: "Medicine"}]})));
  expect(screen.queryByRole("button", {name: "Medicine"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Informatics"}));
  expect(push).toHaveBeenCalledWith("/sites/3/admin");
});
