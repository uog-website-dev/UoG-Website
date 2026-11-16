import {useEffect} from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {AdminQueryProvider} from "@/data/admin-query-provider";
import {useQueryEnvironment, useSiteQuery} from "@/data/query-cache";
import {WorkspaceProvider, useWorkspace, useWorkspaceNavigation} from "@/workspace";
import {SiteWorkspace} from "@/sites/site-workspace";
import {SiteSection} from "@/sites/site-admin-frame";
import {siteSwitchHref} from "@/sites/site-admin";
import type {QueryClient} from "@tanstack/react-query";

const path = vi.fn(() => "/sites/11/admin/pages");
const router = {push: vi.fn(), replace: vi.fn()};
vi.mock("next/navigation", () => ({usePathname: () => path(), useRouter: () => router}));
vi.mock("@/session-watch", () => ({signInAgainIfExpired: vi.fn()}));
const fixture = (id: number) => ({schemaVersion: 1, version: `v${id}`, cacheIdentity: "session", platformPermissions: [], site: {
  id, name: `Site ${id}`, code: `SITE${id}`, status: "ACTIVE", organization: {id: 1, name: "University"},
  defaultLanguage: "en-us", enabledLanguages: ["en-us"], primaryDomain: null, homepageId: null,
  permissions: ["content.pages.view"], enabledModuleCodes: ["PAGES"],
}});
let fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(fixture(11)));
let reads = vi.fn(async (site: number) => `Saved Site ${site}`);
let client: QueryClient, mounts: number;
beforeEach(() => {
  path.mockReturnValue("/sites/11/admin/pages"); router.push.mockReset(); router.replace.mockReset(); mounts = 0;
  fetcher = vi.fn(async (url: string) => Response.json(fixture(Number(new URL(url, "http://local").searchParams.get("site")))));
  reads = vi.fn(async (site: number) => `Saved Site ${site}`);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

function Editor({site}: {site: number}) {
  const rows = useSiteQuery(site, "pages", {}, () => reads(site));
  return <><p>{rows.data ?? "Loading list"}</p><form><input aria-label="Draft title" defaultValue=""/></form></>;
}
function Shell() {
  useEffect(() => {mounts++;}, []);
  client = useQueryEnvironment().client;
  const navigation = useWorkspaceNavigation()!;
  const site = Number(path().match(/sites\/(\d+)/)?.[1]);
  const workspace = useWorkspace(site);
  return <><p data-testid="identity">{navigation.pending?.site.name ?? (workspace.status === "ready" ? workspace.data.site?.name : workspace.status)}</p>
    <button onClick={() => navigation.select({id: 11, name: "Site 11"})}>Choose A</button>
    <button onClick={() => navigation.select({id: 22, name: "Site 22"})}>Choose B</button>
    <SiteWorkspace siteId={site}><SiteSection sectionKey="pages"><Editor site={site}/></SiteSection></SiteWorkspace></>;
}
const App = () => <AdminQueryProvider identity="session"><WorkspaceProvider><Shell/></WorkspaceProvider></AdminQueryProvider>;
function commit(view: ReturnType<typeof render>, href: string) {path.mockReturnValue(href); view.rerender(<App/>);}

it("preserves only authorized section roots and strips object IDs, queries and previews", () => {
  const allowed = {permissions: ["content.pages.view", "content.posts.view", "content.pages.update"], enabledModuleCodes: ["PAGES", "POSTS", "VISUAL_BUILDER"]};
  expect(siteSwitchHref(22, "/sites/11/admin/posts/private-id/preview?token=secret", allowed)).toBe("/sites/22/admin/posts");
  expect(siteSwitchHref(22, "/sites/11/admin/pages/private-id/builder", allowed)).toBe("/sites/22/admin/builder");
  expect(siteSwitchHref(22, "/sites/11/admin/posts", {...allowed, enabledModuleCodes: []})).toBe("/sites/22/admin");
  expect(siteSwitchHref(22, "/sites/11/admin/pages", {...allowed, permissions: []})).toBe("/sites/22/admin");
  expect(siteSwitchHref(22, "/sites/11/admin/unknown")).toBe("/sites/22/admin");
});

it("keeps the shell mounted, guards unsaved forms, updates identity immediately and reuses fresh return context", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  fireEvent.change(screen.getByLabelText("Draft title"), {target: {value: "Private unfinished draft"}});
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByText("Choose B")); expect(router.push).not.toHaveBeenCalled(); expect(screen.getByLabelText("Draft title")).toHaveProperty("value", "Private unfinished draft");
  confirm.mockReturnValue(true); fireEvent.click(screen.getByText("Choose B"));
  expect(screen.getByTestId("identity").textContent).toBe("Site 22"); expect(screen.queryByLabelText("Draft title")).toBeNull();
  expect(router.push).toHaveBeenLastCalledWith("/sites/22/admin/pages");
  commit(view, "/sites/22/admin/pages"); await screen.findByText("Saved Site 22");
  expect(screen.getByLabelText("Draft title")).toHaveProperty("value", ""); expect(mounts).toBe(1);
  fireEvent.click(screen.getByText("Choose A")); commit(view, "/sites/11/admin/pages");
  await screen.findByText("Saved Site 11"); expect(screen.getByLabelText("Draft title")).toHaveProperty("value", "");
  expect(fetcher).toHaveBeenCalledTimes(2); expect(reads).toHaveBeenCalledTimes(2); expect(mounts).toBe(1);
});

it("rapid A to B to A ignores a late denied B response and aborts its transport", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  fireEvent.click(screen.getByText("Choose B")); commit(view, "/sites/22/admin/pages");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByText("Choose A")); commit(view, "/sites/11/admin/pages"); await screen.findByText("Saved Site 11");
  await act(async () => release(Response.json({detail: "Denied"}, {status: 403})));
  expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true); expect(screen.queryByText("Saved Site 22")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(reads).toHaveBeenCalledTimes(1); expect(mounts).toBe(1);
});

it("routes a switched unavailable section to Dashboard without loading its data", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  fetcher.mockResolvedValueOnce(Response.json({...fixture(22), site: {...fixture(22).site, enabledModuleCodes: []}}));
  fireEvent.click(screen.getByText("Choose B")); commit(view, "/sites/22/admin/pages");
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sites/22/admin"));
  expect(reads).toHaveBeenCalledTimes(1); expect(screen.queryByText("Saved Site 11")).toBeNull();
});

it("blocks expired return context until authorization revalidation and purges revoked data", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  fireEvent.click(screen.getByText("Choose B")); commit(view, "/sites/22/admin/pages"); await screen.findByText("Saved Site 22");
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  fireEvent.click(screen.getByText("Choose A")); commit(view, "/sites/11/admin/pages");
  expect(screen.queryByText("Saved Site 11")).toBeNull();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await act(async () => release(Response.json({...fixture(11), site: {...fixture(11).site, permissions: []}})));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sites/11/admin"));
  expect(reads).toHaveBeenCalledTimes(2);
  expect(client.getQueryCache().getAll().some(query => query.queryKey[2] === 11 && query.queryKey[4] === "pages")).toBe(false);
});

it("does not redirect a direct unavailable deep link or disclose cached data on bootstrap failure", async () => {
  fetcher.mockResolvedValueOnce(Response.json({detail: "Not found"}, {status: 404}));
  render(<App/>); await screen.findByText(/This Site workspace is unavailable/);
  expect(reads).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
});

it("Back navigation supersedes a failed pending switch and restores only the previous authorized Site", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  fetcher.mockResolvedValueOnce(Response.json({detail: "Not found"}, {status: 404}));
  fireEvent.click(screen.getByText("Choose B")); commit(view, "/sites/22/admin/pages");
  await screen.findByText(/This Site workspace is unavailable/);
  commit(view, "/sites/11/admin/pages"); await screen.findByText("Saved Site 11");
  expect(screen.getByTestId("identity").textContent).toBe("Site 11"); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("returning near lease expiry does not grant another 30 seconds and timer/focus refreshes share transport", async () => {
  const view = render(<App/>); await screen.findByText("Saved Site 11");
  fireEvent.click(screen.getByText("Choose B")); commit(view, "/sites/22/admin/pages"); await screen.findByText("Saved Site 22");
  const workspace = client.getQueryCache().getAll().find(query => query.queryKey[2] === 11 && query.queryKey[4] === "workspace")!;
  workspace.setState({dataUpdatedAt: Date.now() - 29_500});
  fireEvent.click(screen.getByText("Choose A")); commit(view, "/sites/11/admin/pages"); await screen.findByText("Saved Site 11");
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve;}));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  fireEvent.focus(window); fireEvent.focus(window);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => release(Response.json(fixture(11)))); expect(screen.getByText("Saved Site 11")).toBeTruthy();
});
