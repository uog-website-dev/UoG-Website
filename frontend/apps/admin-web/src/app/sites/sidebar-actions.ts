"use server";

import type { SidebarSnapshot } from "@uog/ui";
import { createApiClient } from "@uog/api-client";
import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

export type SidebarComponent =
  | { id: string; type: "menu"; menu_id: string }
  | { id: string; type: "related_pages"; title: string; page_ids: string[] }
  | { id: string; type: "recent_posts"; title: string; limit: number };
export interface SidebarRecord {
  id: string; site: number; name: string; status: "ACTIVE" | "ARCHIVED";
  version: number; components: SidebarComponent[]; snapshot?: SidebarSnapshot;
}
export interface SidebarMenuOption { id: string; name: string; location: string }

async function client() {
  return createApiClient({ baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api", accessToken: (await getAccessToken()) ?? undefined });
}
async function attempt<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await operation() }; }
  catch (cause) { return { ok: false, error: serializeApiError(cause) }; }
}
function path(site: number) {
  if (!Number.isInteger(site) || site < 1) throw new Error("Choose an active Site.");
  return `/v1/sites/${site}/sidebars/`;
}

export async function listSiteSidebars(site: number): Promise<ActionResult<SidebarRecord[]>> {
  return attempt(async () => {
    const api = await client(), rows: SidebarRecord[] = [];
    let page = 1, next = true;
    while (next && page <= 100) {
      const response = await api.get<{ results: SidebarRecord[]; next: string | null }>(`${path(site)}?page_size=100&page=${page++}`);
      rows.push(...response.results.filter(row => row.site === site));
      next = response.next !== null;
    }
    return rows;
  });
}
export async function sidebarMenuOptions(site: number): Promise<ActionResult<SidebarMenuOption[]>> {
  return attempt(async () => {
    path(site);
    const api = await client(), options: SidebarMenuOption[] = [];
    let page = 1, more = true;
    while (more && page <= 100) {
      const rows = await api.get<{ results: (SidebarMenuOption & { site: number; is_active: boolean; is_global: boolean })[]; next: string | null }>(`/v1/sites/${site}/menus/?page_size=100&page=${page++}`);
      options.push(...rows.results.filter(row => row.site === site && row.is_active && !row.is_global));
      more = Boolean(rows.next);
    }
    return options;
  });
}
export async function saveSiteSidebar(site: number, input: { name: string; components: SidebarComponent[]; status: "ACTIVE" | "ARCHIVED" }, current?: { id: string; version: number }): Promise<ActionResult<SidebarRecord>> {
  return attempt(async () => {
    const api = await client();
    if (!current) return api.post<SidebarRecord>(path(site), input);
    const response = await api.patchDetailed<SidebarRecord>(`${path(site)}${encodeURIComponent(current.id)}/`, input, { ifMatch: `"sidebar-${current.id}-v${current.version}"` });
    return response.data;
  });
}
export async function deleteSiteSidebar(site: number, current: { id: string; version: number }): Promise<ActionResult<null>> {
  return attempt(async () => {
    await (await client()).delDetailed(`${path(site)}${encodeURIComponent(current.id)}/`, { ifMatch: `"sidebar-${current.id}-v${current.version}"` });
    return null;
  });
}
