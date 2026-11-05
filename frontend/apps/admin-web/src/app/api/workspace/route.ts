import { NextResponse } from "next/server";

import { getEffectivePermissions } from "@/access-control";
import { listAllSites, listSiteModuleAssignments } from "@/app/sites/actions";
import { enabledModuleCodes } from "@/sites/site-admin";
import type { WorkspacePayload } from "@/workspace";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Workspaces for the signed-in account. Django filters the Site list by
 * scoped `sites.view` and reports permissions per scope, so this route
 * only reshapes what the API already allowed.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const site = query.get("site");
  if (query.getAll("site").length > 1 || (site != null && (!/^[1-9]\d*$/.test(site) || !Number.isSafeInteger(Number(site))))) {
    return NextResponse.json({ error: "invalid_site" }, { status: 400, headers });
  }
  const siteId = site == null ? null : Number(site);

  const [platformPermissions, sites] = await Promise.all([
    getEffectivePermissions(),
    listAllSites(),
  ]);
  if (!sites.ok && sites.error.status === 401) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  }
  const choices = sites.ok
    ? sites.data.map((row) => ({ id: row.id, name: row.name, code: row.code, status: row.status }))
    : [];

  let current: WorkspacePayload["site"] = null;
  if (siteId != null && choices.some((row) => row.id === siteId)) {
    const [permissions, assignments] = await Promise.all([
      getEffectivePermissions(siteId),
      listSiteModuleAssignments(siteId),
    ]);
    current = {
      id: siteId,
      permissions,
      enabledModuleCodes: assignments.ok ? enabledModuleCodes(assignments.data.results, siteId) : [],
    };
  }

  const payload: WorkspacePayload = {
    platformPermissions,
    sites: choices,
    sitesError: sites.ok ? null : sites.error.message,
    site: current,
  };
  return NextResponse.json(payload, { headers });
}
