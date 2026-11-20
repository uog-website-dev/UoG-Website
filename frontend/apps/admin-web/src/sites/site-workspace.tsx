"use client";
import type {ReactNode} from "react";
import {useMemo} from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import {refreshWorkspace, useWorkspace, useWorkspaceNavigation} from "@/workspace";
import {SiteAdminFrame} from "@/sites/site-admin-frame";
import {RenderProbe} from "@/performance/render-probe";

export function SiteWorkspace({siteId, children}: {siteId: number; children: ReactNode}) {
  const state = useWorkspace(siteId);
  const navigation = useWorkspaceNavigation();
  const activeSite = state.status === "ready" ? state.data.site : null;
  const framedSite = useMemo(() => activeSite ? {...activeSite, organizationId: activeSite.organization.id, organizationName: activeSite.organization.name} : null, [activeSite]);
  if (state.status === "loading") return <p role="status">{navigation?.pending ? `Switching to ${navigation.pending.site.name}…` : "Loading Site workspace…"}</p>;
  if (state.status === "error" || !state.data.site) return <Alert severity="warning" action={<Button onClick={refreshWorkspace}>Retry</Button>}>
    {state.status === "error" && state.signedOut ? "Your session has expired. Sign in again." : "This Site workspace is unavailable or you no longer have access."}
  </Alert>;
  if (!framedSite) return null;
  return <RenderProbe id="site-shell"><SiteAdminFrame site={framedSite}
    permissions={state.data.site.permissions} enabledModuleCodes={state.data.site.enabledModuleCodes}>{children}</SiteAdminFrame></RenderProbe>;
}
