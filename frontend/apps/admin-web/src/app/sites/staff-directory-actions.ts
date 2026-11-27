"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteStaffDirectorySettings, StaffDirectoryScope} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface SiteStaffDirectorySettingsEnvelope {
  site: number;
  version: number;
  settings: SiteStaffDirectorySettings;
  scope: StaffDirectoryScope;
  updated_at: string | null;
  modules: string[];
  aggregation_write_access: boolean;
}

async function api() {
  return createApiClient({
    fetchFn: serverApiFetch,
    baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api",
    accessToken: (await getAccessToken()) ?? undefined,
  });
}

export async function getSiteStaffDirectorySettings(
  site: number,
): Promise<ActionResult<{ data: SiteStaffDirectorySettingsEnvelope; etag: string | null }>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const response = await (await api()).getDetailed<SiteStaffDirectorySettingsEnvelope>(
      `/v1/sites/${site}/staff-directory-settings/`,
    );
    if (response.data.site !== site) throw new Error("Staff Directory settings belong to another Site.");
    return { ok: true, data: { data: response.data, etag: response.etag } };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function updateSiteStaffDirectorySettings(
  site: number,
  etag: string,
  settings: Partial<SiteStaffDirectorySettings>,
): Promise<ActionResult<{ data: SiteStaffDirectorySettingsEnvelope; etag: string | null }>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const response = await (await api()).patchDetailed<SiteStaffDirectorySettingsEnvelope>(
      `/v1/sites/${site}/staff-directory-settings/`,
      settings,
      { ifMatch: etag },
    );
    if (response.data.site !== site) throw new Error("Staff Directory settings belong to another Site.");
    return { ok: true, data: { data: response.data, etag: response.etag } };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}
