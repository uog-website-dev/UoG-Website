"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteEventCategory, SiteEventSettings} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface SiteEventSettingsEnvelope {
  site: number;
  version: number;
  settings: SiteEventSettings;
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

export async function getSiteEventSettings(
  site: number,
): Promise<ActionResult<{ data: SiteEventSettingsEnvelope; etag: string | null }>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const response = await (await api()).getDetailed<SiteEventSettingsEnvelope>(`/v1/sites/${site}/event-settings/`);
    if (response.data.site !== site) throw new Error("Event settings belong to another Site.");
    return { ok: true, data: { data: response.data, etag: response.etag } };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function updateSiteEventSettings(
  site: number,
  etag: string,
  settings: Partial<SiteEventSettings>,
): Promise<ActionResult<{ data: SiteEventSettingsEnvelope; etag: string | null }>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const response = await (await api()).patchDetailed<SiteEventSettingsEnvelope>(
      `/v1/sites/${site}/event-settings/`,
      settings,
      { ifMatch: etag },
    );
    if (response.data.site !== site) throw new Error("Event settings belong to another Site.");
    return { ok: true, data: { data: response.data, etag: response.etag } };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function listSiteEventCategories(
  site: number,
): Promise<ActionResult<SiteEventCategory[]>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const rows = await (await api()).get<SiteEventCategory[]>(
      `/v1/sites/${site}/event-categories/?include_inactive=true`,
    );
    return { ok: true, data: rows };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function saveSiteEventCategory(
  site: number,
  payload: { name: string; description?: string; position?: number; is_active?: boolean },
  categoryId?: string,
): Promise<ActionResult<SiteEventCategory>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    const client = await api();
    const data = categoryId
      ? await client.patch<SiteEventCategory>(`/v1/sites/${site}/event-categories/${categoryId}/`, payload)
      : await client.post<SiteEventCategory>(`/v1/sites/${site}/event-categories/`, payload);
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function deactivateSiteEventCategory(
  site: number,
  categoryId: string,
): Promise<ActionResult<null>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Choose a Site.");
    await (await api()).delete(`/v1/sites/${site}/event-categories/${categoryId}/`);
    return { ok: true, data: null };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}
