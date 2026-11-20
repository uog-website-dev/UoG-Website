"use client";

/**
 * The administration workspace the signed-in account is working in:
 * Platform Administration or one authorized Site. Discovery is lazy and
 * separate; Django still decides every request.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { normalizeAdminPathname, siteWorkspaceId } from "@/navigation";
import type { SiteStatus } from "@uog/types";

import { APP_BASE_PATH } from "@/base-path";
import { signInAgainIfExpired } from "@/session-watch";
import {ApiError} from "@uog/api-client";
import {useQuery} from "@tanstack/react-query";
import {AuthorizationScope, queryKey, STALE_MS, useQueryEnvironment} from "@/data/query-cache";
import {siteSwitchHref} from "@/sites/site-admin";
import {confirmSiteSwitch} from "@/sites/site-draft-guard";

export interface WorkspaceSite {
  id: number;
  name: string;
  code: string;
  status: SiteStatus;
}

export interface WorkspacePayload {
  cacheIdentity?: string;
  schemaVersion: 1;
  version: string;
  platformPermissions: string[];
  site: (WorkspaceSite & {
    organization: { id: number; name: string };
    defaultLanguage: string;
    enabledLanguages: string[];
    primaryDomain: { hostname: string; status: "ACTIVE" | "INACTIVE" } | null;
    homepageId: string | null;
    permissions: string[];
    enabledModuleCodes: string[];
  }) | null;
}

export type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; signedOut: boolean }
  | { status: "ready"; data: WorkspacePayload; refreshing?: boolean };

export const PLATFORM_WORKSPACE = "platform";

export function workspaceValue(siteId: number | null): string {
  return siteId == null ? PLATFORM_WORKSPACE : `site:${siteId}`;
}

/** Where choosing a workspace leads. Switching Sites opens that Site's dashboard. */
export function workspaceHref(value: string): string | null {
  if (value === PLATFORM_WORKSPACE) return "/";
  const match = /^site:([1-9]\d*)$/.exec(value);
  return match ? `/sites/${match[1]}/admin` : null;
}

const WorkspaceContext = createContext<{siteId: number | null; state: WorkspaceState} | null>(null);
interface SiteSwitch {
  site: Pick<WorkspaceSite, "id" | "name">;
  href: string;
}
const NavigationContext = createContext<{pending: SiteSwitch | null; cancel: () => void; select: (site: Pick<WorkspaceSite, "id" | "name">) => boolean} | null>(null);
export function useWorkspaceNavigation() {return useContext(NavigationContext);}

/** Drop all old-Site data synchronously, including while the new request is pending. */
export function WorkspaceProvider({children}: {children: ReactNode}) {
  const path = normalizeAdminPathname(usePathname());
  const routeSite = siteWorkspaceId(path);
  const router = useRouter();
  const [pending, setPending] = useState<SiteSwitch | null>(null);
  const reachedTarget = useRef(false);
  const siteId = pending?.site.id ?? routeSite;
  const environment = useQueryEnvironment();
  const key = queryKey({...environment, siteId, authorization: "bootstrap"}, "workspace", {site: siteId});
  const visit = useRef<{site: number | null; after: number}>({site: siteId, after: 0});
  if (visit.current.site !== siteId) {
    const cached = environment.client.getQueryState(key);
    visit.current = {site: siteId, after: cached?.dataUpdatedAt && (cached.isInvalidated || Date.now() - cached.dataUpdatedAt >= STALE_MS) ? cached.dataUpdatedAt : 0};
  }
  const result = useQuery({queryKey: key, refetchOnWindowFocus: false, queryFn: async ({signal}) => {
    const query = siteId == null ? "" : `?site=${siteId}`;
    const response = await fetch(`${APP_BASE_PATH}/api/workspace/${query}`, {cache: "no-store", signal});
    if (!response.ok) {
      if (response.status === 401) void signInAgainIfExpired();
      throw new ApiError("Workspace unavailable", response.status);
    }
    const data: unknown = await response.json();
    if (!validWorkspace(data, siteId)) throw new Error("Invalid workspace response");
    if (data.cacheIdentity && data.cacheIdentity !== environment.identity) {
      window.dispatchEvent(new CustomEvent("uog:session:changed", {detail: {identity: data.cacheIdentity}}));
      throw new ApiError("Session changed", 401);
    }
    return data;
  }});
  useEffect(() => {
    if (!pending) return;
    if (routeSite === pending.site.id) reachedTarget.current = true;
    else if (reachedTarget.current) setPending(null); // Back/forward supersedes a failed switch.
  }, [pending, routeSite]);
  useEffect(() => {
    const refresh = () => {void environment.client.invalidateQueries({queryKey: key}, {cancelRefetch: false});};
    window.addEventListener("uog:workspace:refresh", refresh);
    window.addEventListener("focus", refresh);
    // Returning just before expiry must not restart a new 30-second lease.
    const expires = result.dataUpdatedAt ? Math.max(1, STALE_MS - (Date.now() - result.dataUpdatedAt)) : STALE_MS;
    const timer = window.setTimeout(() => {if (document.visibilityState === "visible") refresh();}, expires);
    const visible = () => {if (document.visibilityState === "visible" && Date.now() - result.dataUpdatedAt >= STALE_MS) refresh();};
    document.addEventListener("visibilitychange", visible);
    return () => {window.clearTimeout(timer); window.removeEventListener("uog:workspace:refresh", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible);};
  }, [environment.client, environment.identity, siteId, result.dataUpdatedAt]);
  const data = result.data;
  const awaitingValidation = visit.current.after > 0 && result.dataUpdatedAt <= visit.current.after;
  const state = useMemo<WorkspaceState>(() => result.isError ? {status: "error", signedOut: result.error instanceof ApiError && result.error.status === 401}
    : data && !awaitingValidation ? {status: "ready", data, refreshing: result.isFetching} : {status: "loading"}, [result.isError, result.error, data, awaitingValidation, result.isFetching]);
  useEffect(() => {
    // A selection hides the previous editor immediately, before the RSC route arrives.
    void environment.client.cancelQueries({predicate: query => query.queryKey[2] !== siteId});
  }, [siteId, environment.client]);
  useEffect(() => {
    if (!pending || state.status !== "ready" || state.data.site?.id !== pending.site.id || routeSite !== pending.site.id) return;
    const href = siteSwitchHref(pending.site.id, pending.href, state.data.site);
    if (path !== href) {router.replace(href); return;}
    setPending(null);
  }, [pending, state.status, data, routeSite, path, router]);
  const select = useCallback((site: Pick<WorkspaceSite, "id" | "name">) => {
    if (!Number.isSafeInteger(site.id) || site.id < 1) return false;
    if (!confirmSiteSwitch(site.id)) return false;
    const href = siteSwitchHref(site.id, path);
    window.dispatchEvent(new CustomEvent("uog:navigation:request", {detail: {target: `${APP_BASE_PATH}${href}`}}));
    reachedTarget.current = false;
    setPending({site, href});
    router.push(href);
    return true;
  }, [path, router]);
  const cancel = useCallback(() => setPending(null), []);
  const navigationValue = useMemo(() => ({pending, select, cancel}), [pending, select, cancel]);
  const workspaceValue = useMemo(() => ({siteId, state}), [siteId, state]);
  const authorization = state.status === "ready" ? JSON.stringify({platform: data?.platformPermissions, permissions: data?.site?.permissions, modules: data?.site?.enabledModuleCodes, status: data?.site?.status}) : "blocked";
  return createElement(NavigationContext.Provider, {value: navigationValue},
    createElement(WorkspaceContext.Provider, {value: workspaceValue},
      createElement(AuthorizationScope, {authorization, siteId, children})));
}

function validWorkspace(value: unknown, siteId: number | null): value is WorkspacePayload {
  if (!value || typeof value !== "object") return false;
  const data = value as WorkspacePayload;
  if (data.cacheIdentity != null && typeof data.cacheIdentity !== "string") return false;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === "string");
  if (data.schemaVersion !== 1 || typeof data.version !== "string" || !data.version || !strings(data.platformPermissions)) return false;
  if (siteId == null) return data.site === null;
  const site = data.site;
  return !!site && site.id === siteId && typeof site.name === "string" && typeof site.code === "string"
    && ["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"].includes(site.status)
    && !!site.organization && Number.isSafeInteger(site.organization.id) && typeof site.organization.name === "string"
    && typeof site.defaultLanguage === "string" && strings(site.enabledLanguages)
    && (site.primaryDomain === null || (!!site.primaryDomain && typeof site.primaryDomain.hostname === "string" && ["ACTIVE", "INACTIVE"].includes(site.primaryDomain.status)))
    && (site.homepageId === null || typeof site.homepageId === "string")
    && strings(site.permissions) && strings(site.enabledModuleCodes);
}

export function useWorkspace(siteId: number | null): WorkspaceState {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context.siteId === siteId ? context.state : {status: "loading"};
}

export function refreshWorkspace() {window.dispatchEvent(new Event("uog:workspace:refresh"));}
