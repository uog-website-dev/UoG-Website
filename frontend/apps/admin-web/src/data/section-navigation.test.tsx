import {useEffect, useState} from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import type {QueryClient} from "@tanstack/react-query";
import {AuthorizationScope, QueryScope, queryKey, useQueryEnvironment, useSiteQuery} from "./query-cache";
import {useSectionState} from "./section-state";
import {PREFETCH_DWELL_MS, PREFETCH_THROTTLE_MS, useSectionPrefetch} from "./section-prefetch";
import {usePageBoundary} from "./page-boundary";
import {ApiError} from "@uog/api-client";

const {prefetch, counts} = vi.hoisted(() => ({prefetch: vi.fn(), counts: vi.fn()}));
vi.mock("next/navigation", () => ({useRouter: () => ({prefetch})}));
vi.mock("@/app/sites/page-actions", () => ({loadSitePageStatusCounts: (...args: unknown[]) => counts(...args)}));
afterEach(() => {vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals();});
const Scope = ({children, identity = "user", authorization = "editor"}: {children: React.ReactNode; identity?: string; authorization?: string}) =>
  <QueryScope identity={identity} siteId={11}><AuthorizationScope authorization={authorization}>{children}</AuthorizationScope></QueryScope>;
let client: QueryClient;

function Controls({site = 11, persist = true}: {site?: number; persist?: boolean}) {
  client = useQueryEnvironment().client;
  const [search, setSearch] = useSectionState(site, "pages", "search", "", persist);
  const [page, setPage] = useSectionState(site, "pages", "page", 1, persist);
  return <><input aria-label="Search" value={search} onChange={event => setSearch(event.target.value)}/><button onClick={() => {setPage(value => value + 1); setPage(value => value + 1);}}>Next twice</button><span>Page {page}</span></>;
}

it("restores controls on same-Site remount without any network function and keeps sequential edits", () => {
  function App() {const [open, show] = useState(true); return <Scope><button onClick={() => show(value => !value)}>Navigate</button>{open ? <Controls/> : <p>Other section</p>}</Scope>;}
  render(<App/>); fireEvent.change(screen.getByLabelText("Search"), {target: {value: "University"}}); fireEvent.click(screen.getByText("Next twice"));
  expect(screen.getByText("Page 3")).toBeTruthy(); fireEvent.click(screen.getByText("Navigate")); fireEvent.click(screen.getByText("Navigate"));
  expect(screen.getByLabelText("Search")).toHaveProperty("value", "University"); expect(screen.getByText("Page 3")).toBeTruthy();
  expect(client.getQueryCache().getAll().every(query => query.state.fetchStatus === "idle")).toBe(true);
});

it("isolates Sites and clears controls on authorization/session change", () => {
  const view = render(<Scope><Controls/></Scope>); fireEvent.change(screen.getByLabelText("Search"), {target: {value: "Site A"}});
  view.rerender(<Scope><Controls site={22}/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "");
  view.rerender(<Scope><Controls/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "Site A");
  view.rerender(<Scope authorization="viewer"><Controls/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "");
  view.rerender(<Scope identity="another-session" authorization="viewer"><Controls/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "");
});

it("does not restore picker-local controls or reset list controls on content invalidation", async () => {
  const view = render(<Scope><Controls/></Scope>); fireEvent.change(screen.getByLabelText("Search"), {target: {value: "Library search"}});
  await act(async () => window.dispatchEvent(new CustomEvent("uog:data:changed", {detail: {site: 11, domain: "pages"}})));
  expect(screen.getByLabelText("Search")).toHaveProperty("value", "Library search");
  view.rerender(<Scope><Controls key="picker" persist={false}/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("Search"), {target: {value: "Picker only"}});
  view.rerender(<Scope><Controls key="library"/></Scope>); expect(screen.getByLabelText("Search")).toHaveProperty("value", "Library search");
});

function Intent({modules = ["PAGES", "POSTS"], permissions = ["content.pages.view", "content.posts.view"], payloadSite = 11}: {modules?: string[]; permissions?: string[]; payloadSite?: number}) {
  const environment = useQueryEnvironment(); client = environment.client;
  const intent = useSectionPrefetch(11);
  useEffect(() => {client.setQueryData(queryKey({...environment, authorization: "bootstrap"}, "workspace", {site: 11}), {site: {id: payloadSite, enabledModuleCodes: modules, permissions}});}, []);
  return <><button onPointerEnter={() => intent.schedule("pages")} onPointerLeave={intent.cancel} onFocus={() => intent.schedule("pages")} onBlur={intent.cancel}>Pages</button><button onFocus={() => intent.schedule("posts")}>Posts</button></>;
}
async function dwell(ms = PREFETCH_DWELL_MS) {await act(async () => {await vi.advanceTimersByTimeAsync(ms);});}

it("prefetches only after sustained intent and deduplicates the canonical counts query on navigation", async () => {
  vi.useFakeTimers(); let resolve!: (value: unknown) => void;
  counts.mockImplementation(() => new Promise(done => {resolve = done;}));
  const view = render(<Scope><Intent/></Scope>);
  fireEvent.pointerEnter(screen.getByText("Pages")); fireEvent.pointerLeave(screen.getByText("Pages")); await dwell(); expect(prefetch).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByText("Pages")); await dwell(); expect(prefetch).toHaveBeenCalledWith("/sites/11/admin/pages"); expect(counts).toHaveBeenCalledTimes(1);
  function Reader() {const result = useSiteQuery(11, "page-counts", {}, async () => {const response = await counts(11); return response.data;}); return <span>{result.data ? "Counts ready" : "Loading"}</span>;}
  view.rerender(<Scope><Reader/></Scope>); expect(counts).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ok: true, data: {DRAFT: 2}})); await dwell(1); expect(screen.getByText("Counts ready")).toBeTruthy();
});

it("throttles route speculation and does not fetch Posts content", async () => {
  vi.useFakeTimers(); counts.mockResolvedValue({ok: true, data: {DRAFT: 1}}); render(<Scope><Intent/></Scope>);
  fireEvent.focus(screen.getByText("Pages")); await dwell(); fireEvent.focus(screen.getByText("Posts")); await dwell(); expect(prefetch).toHaveBeenCalledTimes(1);
  await dwell(PREFETCH_THROTTLE_MS); fireEvent.focus(screen.getByText("Posts")); await dwell(); expect(prefetch).toHaveBeenCalledTimes(2); expect(counts).toHaveBeenCalledTimes(1);
});

it.each([{modules: []}, {permissions: []}, {payloadSite: 22}])("does not speculate into disabled, unauthorized or foreign context: %j", async props => {
  vi.useFakeTimers(); render(<Scope><Intent {...props}/></Scope>); fireEvent.focus(screen.getByText("Pages")); await dwell(); expect(prefetch).not.toHaveBeenCalled(); expect(counts).not.toHaveBeenCalled();
});

it("skips constrained networks, expired permission leases and unmounted intents", async () => {
  vi.useFakeTimers(); vi.stubGlobal("navigator", {onLine: true, connection: {saveData: true}});
  const view = render(<Scope><Intent/></Scope>); fireEvent.focus(screen.getByText("Pages")); await dwell(); expect(prefetch).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", {onLine: true});
  client.getQueryCache().getAll().find(query => query.queryKey[4] === "workspace")!.setState({dataUpdatedAt: Date.now() - 31_000});
  fireEvent.focus(screen.getByText("Pages")); await dwell(); expect(prefetch).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByText("Pages")); view.unmount(); await dwell(); expect(prefetch).not.toHaveBeenCalled();
});

it.each([{status: 404, message: "Invalid page.", expected: 1}, {status: 404, message: "Not found.", expected: 2}, {status: 403, message: "Invalid page.", expected: 2}, {status: 503, message: "Unavailable", expected: 2}])("recovers only a lost pagination boundary: %j", ({status, message, expected}) => {
  function Boundary() {const [page, setPage] = useSectionState(11, "posts", "page", 2); usePageBoundary(page, setPage, null, new ApiError(message, status)); return <p>Boundary {page}</p>;}
  render(<Scope><Boundary/></Scope>); expect(screen.getByText(`Boundary ${expected}`)).toBeTruthy();
});
