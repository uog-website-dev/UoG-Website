"use client";
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from "react";
import {QueryCache, QueryClient, QueryClientProvider, useQuery} from "@tanstack/react-query";
import {ApiError} from "@uog/api-client";
import {accessFailureWasReported} from "@/organizations/contract";

export const STALE_MS = 30_000;
export const GC_MS = 300_000;
export interface QueryEnvironment {client: QueryClient; identity: string; authorization: string; siteId: number | null}
const Environment = createContext<QueryEnvironment | null>(null);
type QueryIdentity = {queryKey: readonly unknown[]};
// Weak keys retain no client/data after its session boundary is collected.
const pendingInvalidations = new WeakMap<QueryClient, Array<(query: QueryIdentity) => boolean>>();
function invalidate(client: QueryClient, matches: (query: QueryIdentity) => boolean) {
  const pending = pendingInvalidations.get(client);
  if (pending) {pending.push(matches); return;}
  const predicates = [matches]; pendingInvalidations.set(client, predicates);
  queueMicrotask(() => {
    pendingInvalidations.delete(client);
    const filters = {predicate: (query: QueryIdentity) => predicates.some(test => test(query))};
    void client.cancelQueries(filters).then(() => client.invalidateQueries(filters));
  });
}

/** Resource prefixes invalidate all filter/page variants, never another Site/user. */
export function queryKey(scope: Omit<QueryEnvironment, "client">, resource: string, params: unknown = {}) {
  return ["admin", scope.identity, scope.siteId, scope.authorization, resource, params] as const;
}
export function isAccessFailure(error: unknown) {
  return error instanceof ApiError && [401, 403].includes(error.status);
}

/** One in-memory client per authenticated session. No module singleton/persistence. */
export function QueryScope({identity, siteId, children, onDenied, authorization = "bootstrap"}: {
  identity: string; siteId: number | null; children: ReactNode; authorization?: string; onDenied?: () => void;
}) {
  const current = useRef({siteId, onDenied});
  current.current = {siteId, onDenied};
  const [client] = useState(() => new QueryClient({
    queryCache: new QueryCache({onError: (error, query) => {
      if (query.queryKey[2] === current.current.siteId && query.queryKey[4] !== "workspace" && (isAccessFailure(error) || (query.meta?.scopeProtected && error instanceof ApiError && error.status === 404)) && !accessFailureWasReported(error)) current.current.onDenied?.();
    }}),
    defaultOptions: {queries: {staleTime: STALE_MS, gcTime: typeof window === "undefined" ? Infinity : GC_MS, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true}},
  }));
  useEffect(() => () => {void client.cancelQueries(); client.clear();}, [client]);
  const previousSite = useRef(siteId);
  useEffect(() => {
    // Cancel obsolete transport/logical work, retain only bounded read caches.
    const previous = previousSite.current;
    previousSite.current = siteId;
    if (previous !== siteId) void client.cancelQueries({predicate: query => query.queryKey[2] === previous});
  }, [client, siteId]);
  return <QueryClientProvider client={client}><Environment.Provider value={{client, identity, siteId, authorization}}><MutationInvalidation/>{children}</Environment.Provider></QueryClientProvider>;
}

export function useQueryEnvironment() {
  const value = useContext(Environment);
  if (!value) throw new Error("The admin query provider is required");
  return value;
}

export function AuthorizationScope({authorization, siteId, children}: {authorization: string; siteId?: number | null; children: ReactNode}) {
  const parent = useQueryEnvironment();
  const environment = {...parent, siteId: siteId === undefined ? parent.siteId : siteId};
  useEffect(() => {
    if (authorization !== "blocked") window.dispatchEvent(new CustomEvent("uog:authorization:context", {
      detail: {identity: environment.identity, site: environment.siteId, authorization},
    }));
    const obsolete = {predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[2] === environment.siteId && query.queryKey[4] !== "workspace" && query.queryKey[3] !== authorization};
    void environment.client.cancelQueries(obsolete);
    environment.client.removeQueries(obsolete);
  }, [authorization, environment.client, environment.identity, environment.siteId]);
  return <Environment.Provider value={{...environment, authorization}}>{children}</Environment.Provider>;
}

export function useSiteQuery<T>(siteId: number, resource: string, params: unknown, read: () => Promise<T>, options: {
  enabled?: boolean; isEmpty?: (data: T) => boolean; staleTime?: number; gcTime?: number; refetchInterval?: number; scopeProtected?: boolean;
} = {}) {
  const environment = useQueryEnvironment();
  const scope = {...environment, siteId};
  const key = queryKey(scope, resource, params);
  const enabled = options.enabled !== false && !["blocked", "bootstrap"].includes(environment.authorization);
  const result = useQuery({queryKey: key, enabled, staleTime: options.staleTime ?? STALE_MS, gcTime: options.gcTime ?? GC_MS,
    refetchInterval: options.refetchInterval, meta: {scopeProtected: options.scopeProtected === true},
    queryFn: async ({signal}) => {
      // Server Actions cannot carry AbortSignal. Consuming it still cancels the
      // query and prevents a late read from populating an obsolete cache entry.
      const data = await read(); signal.throwIfAborted(); return data;
    },
  });
  const prefix = key.slice(0, 5);
  const reload = () => invalidate(environment.client, query => prefix.every((part, index) => query.queryKey[index] === part));
  const data = enabled && !isAccessFailure(result.error) && !(options.scopeProtected && result.error instanceof ApiError && result.error.status === 404) ? result.data ?? null : null;
  const error = result.error ? result.error instanceof ApiError ? result.error : ApiError.fromUnknown(result.error) : null;
  return {
    data, error, loading: enabled && result.isPending, refreshing: enabled && result.isFetching && data !== null,
    status: result.isError ? "error" as const : data !== null ? "success" as const : enabled ? "loading" as const : "idle" as const,
    empty: data !== null && (options.isEmpty?.(data) ?? false), reload,
    refresh: async () => {
      const refreshed = await result.refetch({cancelRefetch: false});
      if (refreshed.error) throw refreshed.error;
      return refreshed.data as T;
    },
    setData: (update: T | ((previous: T | null) => T)) => environment.client.setQueryData<T>(key,
      previous => typeof update === "function" ? (update as (previous: T | null) => T)(previous ?? null) : update),
  };
}

export const RELATED: Record<string, readonly string[]> = {
  pages: ["pages", "page-counts", "menu-targets", "dashboard-pages", "sidebars", "media-references", "dashboard-summary", "dashboard-activity"],
  posts: ["posts", "taxonomy", "menu-targets", "dashboard-posts", "media-references", "dashboard-summary", "dashboard-activity"],
  menus: ["menus", "menu-detail", "menu-locations", "dashboard-menus", "dashboard-summary"],
  media: ["media", "media-detail", "media-references", "dashboard-media", "dashboard-summary"],
};
export function useInvalidateSite() {
  const environment = useQueryEnvironment();
  return (siteId: number, domain: keyof typeof RELATED) => {
    const resources = RELATED[domain] ?? [domain];
    const matches = (query: QueryIdentity) => query.queryKey[1] === environment.identity
      && query.queryKey[2] === siteId && resources.includes(String(query.queryKey[4]));
    // Cancel before invalidation so a pre-mutation response cannot replace the save.
    invalidate(environment.client, matches);
  };
}

export function MutationInvalidation() {
  const invalidate = useInvalidateSite();
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{site: number; domain: string; workspace?: boolean}>).detail;
      if (Number.isSafeInteger(detail?.site) && RELATED[detail.domain]) invalidate(detail.site, detail.domain);
      if (detail?.workspace) window.dispatchEvent(new Event("uog:workspace:refresh"));
    };
    window.addEventListener("uog:data:changed", changed);
    return () => window.removeEventListener("uog:data:changed", changed);
  }, [invalidate]);
  return null;
}
