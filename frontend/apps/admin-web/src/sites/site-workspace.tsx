"use client";
import type {ReactNode} from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import {refreshWorkspace, useWorkspace} from "@/workspace";
import {SiteAdminFrame} from "@/sites/site-admin-frame";

export function SiteWorkspace({siteId, children}: {siteId: number; children: ReactNode}) {
  const state = useWorkspace(siteId);
  if (state.status === "loading") return <p role="status">Loading Site workspace…</p>;
  if (state.status === "error" || !state.data.site) return <Alert severity="warning" action={<Button onClick={refreshWorkspace}>Retry</Button>}>
    {state.status === "error" && state.signedOut ? "Your session has expired. Sign in again." : "This Site workspace is unavailable or you no longer have access."}
  </Alert>;
  const site = state.data.site;
  return <SiteAdminFrame key={site.id} site={{...site, organizationId: site.organization.id, organizationName: site.organization.name}}
    permissions={site.permissions} enabledModuleCodes={site.enabledModuleCodes}>{children}</SiteAdminFrame>;
}
