"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteHeaderSettings} from "@uog/types";
import type {PublicMenuNode} from "@uog/ui";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface HeaderMenuSlotState {
  published: string | null;
  draft: string | null;
  is_published: boolean;
  has_changes: boolean;
}

export interface SiteHeaderEnvelope {
  site: number;
  version: number;
  settings: SiteHeaderSettings;
  menus: { header: PublicMenuNode[]; utility: PublicMenuNode[] };
  menu_state: { header: HeaderMenuSlotState; utility: HeaderMenuSlotState };
  site_origin: string | null;
  modules: string[];
  branding: { name: string; theme: "institutional" | "high-contrast"; logo_asset_id: string | null };
}

async function request(
  site: number,
  settings?: SiteHeaderSettings,
  etag?: string,
): Promise<ActionResult<{ data: SiteHeaderEnvelope; etag: string | null }>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const api = createApiClient({
      fetchFn: serverApiFetch,
      baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api",
      accessToken: (await getAccessToken()) ?? undefined,
    });
    const path = `/v1/sites/${site}/header/`;
    const response = settings
      ? await api.patchDetailed<SiteHeaderEnvelope>(path, settings, { ifMatch: etag ?? "" })
      : await api.getDetailed<SiteHeaderEnvelope>(path);
    if (response.data.site !== site) throw new Error("Header settings belong to another Site.");
    return { ok: true, data: { data: response.data, etag: response.etag } };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function getSiteHeader(site: number) { return request(site); }
export async function updateSiteHeader(site: number, etag: string, settings: SiteHeaderSettings) {
  return request(site, settings, etag);
}
