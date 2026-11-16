"use server";
import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError, type ActionResult} from "@/organizations/contract";

export interface DashboardSection {status: "ready" | "unavailable"; counts?: Record<string, number>}
export interface DashboardSummary {
  schema_version: 1; site: number; generated_at: string; expires_at: string; partial: boolean;
  sections: Partial<Record<"pages" | "posts" | "menus" | "media" | "users", DashboardSection>>;
  cache: {hit: boolean; available: boolean; ttl_seconds: number};
}
export interface DashboardActivity {
  site: number; generated_at: string;
  results: Array<{id: string; kind: "pages" | "posts"; title: string; status: string; updated_at: string}>;
}
function validSummary(data: DashboardSummary) {
  if (data.schema_version !== 1 || !Number.isFinite(Date.parse(data.generated_at)) || !Number.isFinite(Date.parse(data.expires_at)) || typeof data.partial !== "boolean" || !data.cache || typeof data.cache.hit !== "boolean" || typeof data.cache.available !== "boolean" || !Number.isInteger(data.cache.ttl_seconds) || data.cache.ttl_seconds < 1 || data.cache.ttl_seconds > 60 || !data.sections || typeof data.sections !== "object" || Array.isArray(data.sections)) return false;
  return Object.entries(data.sections).every(([kind, section]) => {
    if (!["pages", "posts", "menus", "media", "users"].includes(kind) || !section || !["ready", "unavailable"].includes(section.status)) return false;
    if (section.status === "unavailable") return section.counts === undefined;
    const fields = kind === "pages" || kind === "posts" ? ["total", "DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"] : kind === "menus" ? ["total", "active", "items"] : ["total"];
    return !!section.counts && fields.every(field => Number.isSafeInteger(section.counts![field]) && section.counts![field]! >= 0);
  });
}
function validActivity(data: DashboardActivity) {
  return Number.isFinite(Date.parse(data.generated_at)) && Array.isArray(data.results) && data.results.length <= 5 && data.results.every(row => row && typeof row.id === "string" && /^[0-9a-f-]{36}$/.test(row.id) && ["pages", "posts"].includes(row.kind) && typeof row.title === "string" && typeof row.status === "string" && Number.isFinite(Date.parse(row.updated_at)));
}
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
