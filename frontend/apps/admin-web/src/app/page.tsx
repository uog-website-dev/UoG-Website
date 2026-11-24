import Alert from "@mui/material/Alert";
import { redirect } from "next/navigation";

import { getAccessToken } from "@/access-token";
import { APP_BASE_PATH } from "@/base-path";
import { hasPlatformWorkspace } from "@/navigation";
import { serverApiFetch } from "@/performance/server-fetch";
import { siteOrigin } from "@/auth";
import { singleAuthorizedSiteId } from "@/workspace-entry";

import AdminDashboard from "./dashboard-client";

const apiBaseUrl = () => process.env.API_BASE_URL ?? "http://backend:8000/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSiteDiscovery(value: unknown): value is {
  count: number;
  results: { id: number; name: string; code: string; status: string }[];
} {
  if (!isRecord(value) || !Number.isSafeInteger(value.count) || (value.count as number) < 0 || !Array.isArray(value.results)) {
    return false;
  }
  const count = value.count as number;
  return value.results.length === Math.min(count, 2) && value.results.every((row: unknown) =>
    isRecord(row) && Number.isSafeInteger(row.id) && typeof row.id === "number" && row.id > 0
      && typeof row.name === "string" && typeof row.code === "string" && typeof row.status === "string",
  );
}

function WorkspaceLookupError() {
  return <Alert severity="error" role="alert">Your authorized Site workspace could not be determined. Refresh the page to try again.</Alert>;
}

async function findSingleSiteWorkspace(token: string): Promise<number | null> {
  const headers = { Authorization: `Bearer ${token}` };
  const bootstrapResponse = await serverApiFetch(`${apiBaseUrl()}/workspace/`, { headers, cache: "no-store" });
  if (!bootstrapResponse.ok) throw new Error("Workspace bootstrap failed");
  const bootstrap: unknown = await bootstrapResponse.json();
  if (!isRecord(bootstrap) || !Array.isArray(bootstrap.platformPermissions)
    || !bootstrap.platformPermissions.every((permission: unknown) => typeof permission === "string")) {
    throw new Error("Invalid workspace bootstrap");
  }

  const platformPermissions = bootstrap.platformPermissions as string[];
  if (hasPlatformWorkspace(platformPermissions)) return null;

  const sitesResponse = await serverApiFetch(`${apiBaseUrl()}/workspace/sites/?page=1&page_size=2`, { headers, cache: "no-store" });
  if (!sitesResponse.ok) throw new Error("Site discovery failed");
  const discovery: unknown = await sitesResponse.json();
  if (!isSiteDiscovery(discovery)) throw new Error("Invalid Site discovery");
  return singleAuthorizedSiteId(platformPermissions, discovery);
}

export default async function AdminHomePage() {
  const token = await getAccessToken();
  if (!token) return <AdminDashboard />;

  let siteId: number | null;
  try {
    siteId = await findSingleSiteWorkspace(token);
  } catch {
    return <WorkspaceLookupError />;
  }
  if (siteId !== null) redirect(`${siteOrigin}${APP_BASE_PATH}/sites/${siteId}/admin`);
  return <AdminDashboard />;
}
