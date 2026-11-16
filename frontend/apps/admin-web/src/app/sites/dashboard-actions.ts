"use server";
import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError, type ActionResult} from "@/organizations/contract";

import {validSummary, validActivity, type DashboardSummary, type DashboardActivity} from "@/data/dashboard-contract";
export type {DashboardSection, DashboardSummary, DashboardActivity} from "@/data/dashboard-contract";
async function read<T extends {site: number}>(site: number, activity = false): Promise<ActionResult<T>> {
  try {
    if (!Number.isSafeInteger(site) || site < 1) throw new Error("Invalid Site.");
    const api = createApiClient({baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api", accessToken: (await getAccessToken()) ?? undefined, fetchFn: serverApiFetch});
    const data = await api.get<T>(`/workspace/dashboard/${activity ? "activity/" : ""}?site=${site}`);
    if (data.site !== site) throw new Error("The dashboard belongs to another Site.");
    if (!(activity ? validActivity(data as unknown as DashboardActivity) : validSummary(data as unknown as DashboardSummary))) throw new Error("Invalid dashboard response.");
    return {ok: true, data};
  } catch (cause) {return {ok: false, error: serializeApiError(cause)};}
}
export async function getSiteDashboardSummary(site: number) {return read<DashboardSummary>(site);}
export async function getSiteDashboardActivity(site: number) {return read<DashboardActivity>(site, true);}
