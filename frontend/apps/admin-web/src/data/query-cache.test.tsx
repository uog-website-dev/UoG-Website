import {StrictMode, useState} from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {ApiError} from "@uog/api-client";
import type {QueryClient} from "@tanstack/react-query";
import {AuthorizationScope, GC_MS, QueryScope, STALE_MS, queryKey, useQueryEnvironment, useSiteQuery} from "./query-cache";
import {AdminQueryProvider} from "./admin-query-provider";
import {WorkspaceProvider, useWorkspace} from "@/workspace";
import {unwrap} from "@/organizations/contract";
import {invalidated} from "./mutation-receipt";
import {SessionSignOutForm} from "@/session-sign-out-form";

const path = vi.fn(() => "/sites/11/admin");
vi.mock("next/navigation", () => ({usePathname: () => path(), useRouter: () => ({push: vi.fn(), replace: vi.fn()})}));
vi.mock("@/session-watch", () => ({signInAgainIfExpired: vi.fn()}));
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); path.mockReturnValue("/sites/11/admin");});

function Probe({label = "list", site = 11, resource = "pages", params = {}, read, staleTime, gcTime, capture}: {
  label?: string; site?: number; resource?: string; params?: unknown; read: () => Promise<string>; staleTime?: number; gcTime?: number; capture?: (client: QueryClient) => void;
}) {
  const state = useSiteQuery(site, resource, params, read, {staleTime, gcTime});
  capture?.(useQueryEnvironment().client);
  return <div data-testid={label}><span>{state.data ?? "Loading"}</span>{state.refreshing ? <span>Refreshing</span> : null}{state.error ? <span>{state.error.message}</span> : null}<button onClick={state.reload}>Refresh {label}</button></div>;
}
const Scope = ({children}: {children: React.ReactNode}) => <QueryScope identity="user-A-session" siteId={11} authorization="editor-v1">{children}</QueryScope>;

it("deduplicates simultaneous reads and reuses the same section across navigation without a loading flash", async () => {
  const read = vi.fn(async () => "Saved list");
  function App() {const [open, setOpen] = useState(true); return <Scope><button onClick={() => setOpen(value => !value)}>Navigate</button>{open ? <><Probe label="one" read={read}/><Probe label="two" read={read}/></> : <p>Other section</p>}</Scope>;}
  render(<App/>);
  await waitFor(() => expect(screen.getByTestId("two").textContent).toContain("Saved list"));
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Navigate")); fireEvent.click(screen.getByText("Navigate"));
  expect(screen.getByTestId("one").textContent).toContain("Saved list");
  expect(screen.queryByText("Loading")).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
});

it("partitions keys by user/session, Site, permissions, resource, filters, sort and page", () => {
  const scope = {identity: "session-A", siteId: 11, authorization: "editor"};
  const params = {search: "news", status: "PUBLISHED", page: 1, ordering: "-published_at"};
  const base = queryKey(scope, "posts", params);
  const changes = [queryKey({...scope, identity: "session-B"}, "posts", params), queryKey({...scope, siteId: 22}, "posts", params), queryKey({...scope, authorization: "viewer"}, "posts", params), queryKey(scope, "pages", params), queryKey(scope, "posts", {...params, page: 2}), queryKey(scope, "posts", {...params, search: "research"}), queryKey(scope, "posts", {...params, ordering: "title"})];
  expect(new Set([base, ...changes].map(key => JSON.stringify(key))).size).toBe(changes.length + 1);
});

it("shows stale valid data while refreshing, reports failure and recovers without discarding cached rows", async () => {
  const read = vi.fn(async () => "Cached rows");
  render(<Scope><Probe read={read}/></Scope>);
  await screen.findByText("Cached rows");
  let reject!: (error: Error) => void;
  read.mockImplementationOnce(() => new Promise((_resolve, fail) => {reject = fail;}));
  fireEvent.click(screen.getByText("Refresh list"));
  await screen.findByText("Refreshing"); expect(screen.getByText("Cached rows")).toBeTruthy();
  await act(async () => reject(new Error("Temporary outage")));
  await screen.findByText("Temporary outage"); expect(screen.getByText("Cached rows")).toBeTruthy();
  read.mockResolvedValueOnce("New rows"); fireEvent.click(screen.getByText("Refresh list"));
  await screen.findByText("New rows"); expect(screen.queryByText("Temporary outage")).toBeNull();
});

it("invalidates only the mutated Site/domain, including other mounted consumers; failed writes leave cache intact", async () => {
  const pages = vi.fn(async () => "Page A"), foreign = vi.fn(async () => "Page B"), media = vi.fn(async () => "Image A");
  render(<Scope><Probe read={pages}/><Probe label="foreign" site={22} read={foreign}/><Probe label="media" resource="media" read={media}/></Scope>);
  await screen.findByText("Image A"); await screen.findByText("Page A");
  await act(async () => unwrap(await invalidated(11, "pages", Promise.resolve({ok: true, data: {id: "saved"}}))));
  await waitFor(() => expect(pages).toHaveBeenCalledTimes(2)); expect(media).toHaveBeenCalledTimes(1); expect(foreign).toHaveBeenCalledTimes(1);
  const failed = await invalidated(11, "pages", Promise.resolve({ok: false, error: {status: 400, code: "validation_error", message: "Invalid title", details: null, requestId: null}}));
  expect(() => unwrap(failed)).toThrow("Invalid title"); expect(pages).toHaveBeenCalledTimes(2); expect(screen.getByText("Page A")).toBeTruthy();
});

it("cancels a slow obsolete filter and cannot replace the newer query with its late response", async () => {
  let release!: (value: string) => void; const slow = vi.fn(() => new Promise<string>(resolve => {release = resolve;}));
  const fast = vi.fn(async () => "New filter"); let client!: QueryClient;
  const view = render(<Scope><Probe params={{search: "old"}} read={slow} capture={value => {client = value;}}/></Scope>);
  view.rerender(<Scope><Probe params={{search: "new"}} read={fast}/></Scope>);
  await screen.findByText("New filter"); await act(async () => release("Old secret"));
  expect(screen.queryByText("Old secret")).toBeNull();
  const old = client.getQueryCache().getAll().find(query => JSON.stringify(query.queryKey[5]).includes('"old"'));
  expect(old?.state.data).toBeUndefined();
});

it("clears the previous session and Site client on rapid boundary changes, even when requests finish late", async () => {
  let client!: QueryClient; let release!: (value: string) => void;
  const old = () => new Promise<string>(resolve => {release = resolve;});
  const view = render(<AdminQueryProvider identity="A"><AuthorizationScope authorization="editor"><Probe read={old} capture={value => {client = value;}}/></AuthorizationScope></AdminQueryProvider>);
  path.mockReturnValue("/sites/22/admin");
  view.rerender(<AdminQueryProvider identity="B"><AuthorizationScope authorization="editor"><Probe site={22} read={async () => "User B Site B"}/></AuthorizationScope></AdminQueryProvider>);
  await screen.findByText("User B Site B"); await act(async () => release("User A Site A"));
  expect(client.getQueryCache().getAll()).toHaveLength(0); expect(screen.queryByText("User A Site A")).toBeNull();
  act(() => window.dispatchEvent(new Event("uog:session:clear")));
  expect(screen.getByText("Signing out…")).toBeTruthy(); expect(screen.queryByText("User B Site B")).toBeNull();
});

it("purges protected entries when authorization changes or a refreshed workspace revokes access", async () => {
  let client!: QueryClient; const read = vi.fn(async () => "Private article");
  const view = render(<Scope><AuthorizationScope authorization="role-v1"><Probe read={read} capture={value => {client = value;}}/></AuthorizationScope></Scope>);
  await screen.findByText("Private article");
  view.rerender(<Scope><AuthorizationScope authorization="blocked"><Probe read={read}/></AuthorizationScope></Scope>);
  await waitFor(() => expect(client.getQueryCache().getAll().every(query => query.state.data === undefined)).toBe(true)); expect(screen.queryByText("Private article")).toBeNull();
  view.unmount();
  const payload = {schemaVersion: 1, version: "v1", cacheIdentity: "account", platformPermissions: [], site: {id: 11, name: "Site A", code: "A", status: "ACTIVE", organization: {id: 1, name: "University"}, defaultLanguage: "en-us", enabledLanguages: ["en-us"], homepageId: null, primaryDomain: null, permissions: ["sites.view"], enabledModuleCodes: ["PAGES"]}};
  const fetcher = vi.fn(async () => Response.json(payload)); vi.stubGlobal("fetch", fetcher);
  function Page() {const workspace = useWorkspace(11); return workspace.status === "ready" ? <Probe read={read} capture={value => {client = value;}}/> : <p>{workspace.status}</p>;}
  render(<AdminQueryProvider identity="account"><WorkspaceProvider><Page/></WorkspaceProvider></AdminQueryProvider>);
  await screen.findByText("Private article");
  fetcher.mockResolvedValueOnce(Response.json({error: "Not found"}, {status: 404}));
  act(() => window.dispatchEvent(new Event("uog:workspace:refresh")));
  await screen.findByText("error"); expect(screen.queryByText("Private article")).toBeNull();
  expect(client.getQueryCache().getAll().filter(query => query.queryKey[4] !== "workspace")).toHaveLength(0);
});

it("uses finite defaults and garbage-collects unobserved entries", async () => {
  expect(STALE_MS).toBe(30_000); expect(GC_MS).toBe(300_000);
  let client!: QueryClient;
  const view = render(<Scope><Probe gcTime={20} read={async () => "Short-lived"} capture={value => {client = value;}}/></Scope>);
  await screen.findByText("Short-lived"); view.rerender(<Scope><p>Other section</p></Scope>);
  await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
});

it("does not reuse data after an identity-change event even when Site and permissions are identical", async () => {
  let account = "Account A"; const read = vi.fn(async () => account); let previous!: QueryClient;
  render(<AdminQueryProvider identity="session-A"><AuthorizationScope authorization="same-role"><Probe read={read} capture={client => {if (!previous) previous = client;}}/></AuthorizationScope></AdminQueryProvider>);
  await screen.findByText("Account A"); account = "Account B";
  act(() => window.dispatchEvent(new CustomEvent("uog:session:changed", {detail: {identity: "session-B"}})));
  expect(screen.queryByText("Account A")).toBeNull(); await screen.findByText("Account B");
  expect(read).toHaveBeenCalledTimes(2); expect(previous.getQueryCache().getAll()).toHaveLength(0);
});

it("automatically refreshes an expired entry on return while keeping its valid rows visible", async () => {
  const read = vi.fn(async () => "Previously loaded");
  const view = render(<Scope><Probe read={read}/></Scope>);
  await screen.findByText("Previously loaded");
  view.rerender(<Scope><p>Other section</p></Scope>);
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + STALE_MS + 1);
  let release!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise<string>(resolve => {release = resolve;}));
  view.rerender(<Scope><Probe read={read}/></Scope>);
  expect(screen.getByText("Previously loaded")).toBeTruthy(); expect(screen.queryByText("Loading")).toBeNull();
  await screen.findByText("Refreshing"); await act(async () => release("Freshly loaded"));
  await screen.findByText("Freshly loaded"); expect(read).toHaveBeenCalledTimes(2);
});

it("a successful mutation cancels the pre-save read and coalesces duplicate invalidations", async () => {
  const read = vi.fn(async () => "Original");
  render(<Scope><Probe read={read}/></Scope>); await screen.findByText("Original");
  let release!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise<string>(resolve => {release = resolve;}));
  fireEvent.click(screen.getByText("Refresh list")); await screen.findByText("Refreshing");
  read.mockResolvedValueOnce("Saved revision");
  act(() => {
    unwrap({ok: true, data: {}, invalidation: {site: 11, domain: "pages"}});
    fireEvent.click(screen.getByText("Refresh list"));
  });
  await screen.findByText("Saved revision"); await act(async () => release("Obsolete pre-save revision"));
  expect(screen.queryByText("Obsolete pre-save revision")).toBeNull(); expect(read).toHaveBeenCalledTimes(3);
});

it("settles after development StrictMode effect replay", async () => {
  render(<StrictMode><Scope><Probe read={async () => "Usable data"}/></Scope></StrictMode>);
  await screen.findByText("Usable data"); expect(screen.queryByText("Loading")).toBeNull();
});

it("clears protected content on logout while still invoking the sign-out action", async () => {
  const action = vi.fn(async () => {});
  render(<AdminQueryProvider identity="logout-account"><AuthorizationScope authorization="editor"><Probe read={async () => "Protected list"}/><SessionSignOutForm action={action}><button type="submit">Sign out now</button></SessionSignOutForm></AuthorizationScope></AdminQueryProvider>);
  await screen.findByText("Protected list"); fireEvent.click(screen.getByText("Sign out now"));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Signing out…")).toBeTruthy(); expect(screen.queryByText("Protected list")).toBeNull();
});

it("revalidates an unchanged forbidden resource once instead of looping workspace bootstraps", async () => {
  const payload = {schemaVersion: 1, version: "same-context", cacheIdentity: "account", platformPermissions: [], site: {id: 11, name: "Site A", code: "A", status: "ACTIVE", organization: {id: 1, name: "University"}, defaultLanguage: "en-us", enabledLanguages: ["en-us"], homepageId: null, primaryDomain: null, permissions: ["sites.view"], enabledModuleCodes: ["PAGES"]}};
  const fetcher = vi.fn(async () => Response.json(payload)); vi.stubGlobal("fetch", fetcher);
  const read = vi.fn(async () => {throw new ApiError("Forbidden resource", 403);});
  function Page() {const state = useWorkspace(11); return state.status === "ready" ? <Probe read={read}/> : <p>{state.status}</p>;}
  render(<AdminQueryProvider identity="account"><WorkspaceProvider><Page/></WorkspaceProvider></AdminQueryProvider>);
  await screen.findByText("Forbidden resource");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 30));});
  expect(read).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("a late denied read from an abandoned Site cannot reset the new Site's cache", async () => {
  let release!: () => void;
  const old = () => new Promise<string>((resolve, reject) => {release = () => {
    try {resolve(unwrap({ok: false, error: {status: 403, code: "permission_denied", message: "Former Site denied", details: null, requestId: null}}));}
    catch (error) {reject(error);}
  };});
  const current = vi.fn(async () => "Current Site data");
  const view = render(<AdminQueryProvider identity="account"><AuthorizationScope authorization="editor"><Probe read={old}/></AuthorizationScope></AdminQueryProvider>);
  path.mockReturnValue("/sites/22/admin");
  view.rerender(<AdminQueryProvider identity="account"><AuthorizationScope authorization="editor"><Probe site={22} read={current}/></AuthorizationScope></AdminQueryProvider>);
  await screen.findByText("Current Site data"); await act(async () => release());
  expect(screen.getByText("Current Site data")).toBeTruthy(); expect(current).toHaveBeenCalledTimes(1);
});
