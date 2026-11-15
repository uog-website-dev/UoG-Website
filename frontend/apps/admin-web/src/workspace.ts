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

export interface WorkspaceSite {
  id: number;
  name: string;
  code: string;
  status: SiteStatus;
}

export interface WorkspacePayload {
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
  | { status: "ready"; data: WorkspacePayload };

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
  const key = siteId == null ? "platform" : String(siteId);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{key: string; revision: number; state: WorkspaceState}>({key: "", revision: -1, state: {status: "loading"}});
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("uog:workspace:refresh", refresh);
    window.addEventListener("focus", refresh);
    return () => {window.removeEventListener("uog:workspace:refresh", refresh); window.removeEventListener("focus", refresh);};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const save = (state: WorkspaceState) => {if (active) setSnapshot({key, revision, state});};
    const query = siteId == null ? "" : `?site=${siteId}`;
    void fetch(`${APP_BASE_PATH}/api/workspace/${query}`, {cache: "no-store", signal: controller.signal})
      .then(async response => {
        if (!active) return;
        if (!response.ok) {
          save({status: "error", signedOut: response.status === 401});
          if (response.status === 401) void signInAgainIfExpired();
          return;
        }
        const data: unknown = await response.json();
        if (!validWorkspace(data, siteId)) throw new Error("Invalid workspace response");
        save({status: "ready", data});
      }).catch(() => {if (active) save({status: "error", signedOut: false});});
    return () => {active = false; controller.abort();};
  }, [key, revision, siteId]);
  // Same-Site revalidation must not unmount an editor and discard its draft.
  // Site changes still hide all old context immediately; failures fail closed.
  const state: WorkspaceState = snapshot.key === key ? snapshot.state : {status: "loading"};
  return createElement(WorkspaceContext.Provider, {value: {siteId, state}}, children);
}

function validWorkspace(value: unknown, siteId: number | null): value is WorkspacePayload {
  if (!value || typeof value !== "object") return false;
  const data = value as WorkspacePayload;
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
