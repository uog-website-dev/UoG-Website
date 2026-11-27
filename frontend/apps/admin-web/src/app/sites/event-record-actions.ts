"use server";
import {createApiClient} from "@uog/api-client";
import type {SiteEventInput, SiteEventRecord} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface EventListQuery {
  search?: string;
  status?: string;
  category?: string;
  date_from?: string;
  date_to?: string;
  lifecycle?: string;
  page?: number;
  page_size?: number;
}

export interface EventListResult {
  count: number;
  next: string | null;
  previous: string | null;
  results: SiteEventRecord[];
}

async function api() {
  return createApiClient({
    fetchFn: serverApiFetch,
    baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api",
    accessToken: (await getAccessToken()) ?? undefined,
  });
}

function base(site: number) {
  return `/v1/sites/${site}/events/`;
}

export async function listSiteEvents(
  site: number,
  query: EventListQuery = {},
): Promise<ActionResult<EventListResult>> {
  try {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    const data = await (await api()).get<EventListResult>(`${base(site)}${suffix}`);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function getSiteEvent(
  site: number,
  eventId: string,
): Promise<ActionResult<{data: SiteEventRecord; etag: string | null}>> {
  try {
    const response = await (await api()).getDetailed<SiteEventRecord>(`${base(site)}${eventId}/`);
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createSiteEvent(
  site: number,
  payload: SiteEventInput,
): Promise<ActionResult<{data: SiteEventRecord; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<SiteEventRecord>(base(site), payload);
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateSiteEvent(
  site: number,
  eventId: string,
  etag: string,
  payload: SiteEventInput,
): Promise<ActionResult<{data: SiteEventRecord; etag: string | null}>> {
  try {
    const response = await (await api()).patchDetailed<SiteEventRecord>(
      `${base(site)}${eventId}/`,
      payload,
      {ifMatch: etag},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function eventWorkflow(
  site: number,
  eventId: string,
  action: "publish" | "cancel" | "archive" | "duplicate",
  etag?: string,
  body: {notice?: string} = {},
): Promise<ActionResult<{data: SiteEventRecord; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<SiteEventRecord>(
      `${base(site)}${eventId}/${action}/`,
      body,
      action === "duplicate" ? undefined : {headers: {"If-Match": etag ?? ""}},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function previewSiteEvent(
  site: number,
  eventId: string,
): Promise<ActionResult<SiteEventRecord>> {
  try {
    const data = await (await api()).get<SiteEventRecord>(`${base(site)}${eventId}/preview/`);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export interface EventRegistrationRow {
  id: string;
  email: string;
  participant_name: string;
  organization: string;
  phone: string;
  status: string;
  waitlist_position: number | null;
  notification_status: string;
  created_at: string;
  cancelled_at: string | null;
}

export interface EventRegistrationInventory {
  summary: {
    confirmed: number;
    waitlisted: number;
    cancelled: number;
    capacity: number | null;
    seats_remaining: number | null;
    state: string;
  };
  results: EventRegistrationRow[];
}

export async function listSiteEventRegistrations(
  site: number,
  eventId: string,
  status?: string,
): Promise<ActionResult<EventRegistrationInventory>> {
  try {
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await (await api()).get<EventRegistrationInventory>(
      `${base(site)}${eventId}/registrations/${params}`,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
