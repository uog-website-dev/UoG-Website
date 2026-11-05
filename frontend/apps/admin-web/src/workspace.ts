"use client";

/**
 * The administration workspace the signed-in account is working in:
 * Platform Administration or one authorized Site. The selector offers only
 * what `/api/workspace` returned, and Django still decides every request.
 */
import { useEffect, useState } from "react";
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
  platformPermissions: string[];
  sites: WorkspaceSite[];
  sitesError: string | null;
  site: { id: number; permissions: string[]; enabledModuleCodes: string[] } | null;
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

export function useWorkspace(siteId: number | null): WorkspaceState {
  const [state, setState] = useState<{ key: string; value: WorkspaceState }>({
    key: "",
    value: { status: "loading" },
  });
  const key = siteId == null ? "" : String(siteId);

  useEffect(() => {
    let active = true;
    const query = siteId == null ? "" : `?site=${siteId}`;
    void fetch(`${APP_BASE_PATH}/api/workspace/${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setState({ key, value: { status: "error", signedOut: response.status === 401 } });
          if (response.status === 401) void signInAgainIfExpired();
          return;
        }
        const data = (await response.json()) as WorkspacePayload;
        if (active) setState({ key, value: { status: "ready", data } });
      })
      .catch(() => {
        if (active) setState({ key, value: { status: "error", signedOut: false } });
      });
    return () => {
      active = false;
    };
  }, [key, siteId]);

  return state.key === key ? state.value : { status: "loading" };
}
