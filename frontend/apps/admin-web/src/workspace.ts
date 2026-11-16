"use client";

/**
 * The administration workspace the signed-in account is working in:
 * Platform Administration or one authorized Site. Discovery is lazy and
 * separate; Django still decides every request.
 */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { normalizeAdminPathname, siteWorkspaceId } from "@/navigation";
import type { SiteStatus } from "@uog/types";

import { APP_BASE_PATH } from "@/base-path";
import { signInAgainIfExpired } from "@/session-watch";
import {ApiError} from "@uog/api-client";
import {useQuery} from "@tanstack/react-query";
import {AuthorizationScope, queryKey, useQueryEnvironment} from "@/data/query-cache";

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

/** Drop all old-Site data synchronously, including while the new request is pending. */
export function WorkspaceProvider({children}: {children: ReactNode}) {
  const siteId = siteWorkspaceId(normalizeAdminPathname(usePathname()));
  const environment = useQueryEnvironment();
  const key = queryKey({...environment, siteId, authorization: "bootstrap"}, "workspace", {site: siteId});
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
    const refresh = () => {void environment.client.invalidateQueries({queryKey: key});};
    window.addEventListener("uog:workspace:refresh", refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => {if (document.visibilityState === "visible") refresh();}, 30_000);
    return () => {window.clearInterval(timer); window.removeEventListener("uog:workspace:refresh", refresh); window.removeEventListener("focus", refresh);};
  }, [environment.client, environment.identity, siteId]);
  const data = result.data;
  const state: WorkspaceState = result.isError ? {status: "error", signedOut: result.error instanceof ApiError && result.error.status === 401}
    : data ? {status: "ready", data, refreshing: result.isFetching} : {status: "loading"};
  const authorization = state.status === "ready" ? JSON.stringify({platform: data?.platformPermissions, permissions: data?.site?.permissions, modules: data?.site?.enabledModuleCodes, status: data?.site?.status}) : "blocked";
  return createElement(WorkspaceContext.Provider, {value: {siteId, state}},
    createElement(AuthorizationScope, {authorization, children}));
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
