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
  display_category: string;
  source: string;
  waitlist_position: number | null;
  notification_status: string;
  check_in_token: string;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
}

export interface EventRegistrationInventory {
  summary: {
    confirmed: number;
    waitlisted: number;
    cancelled: number;
    invited: number;
    capacity: number | null;
    seats_remaining: number | null;
    state: string;
  };
  count: number;
  page: number;
  page_size: number;
  results: EventRegistrationRow[];
}

export interface ParticipantListQuery {
  status?: string;
  category?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface ParticipantCreateInput {
  participant_name: string;
  email: string;
  organization?: string;
  phone?: string;
  display_category?: string;
  mode: "invite" | "register";
  request_id?: string;
}

export interface ParticipantBadge {
  event_title: string;
  participant_name: string;
  display_category: string;
  check_in_token: string;
  qr_payload?: string;
  fields: string[];
}

export interface AttendanceRow {
  id: string;
  event: string;
  registration: string;
  checked_in_at: string;
  checked_out_at: string | null;
  method: string;
  operator: number | null;
  notes: string;
  replayed?: boolean;
}

export interface EventReportMetrics {
  registrations: number;
  confirmed: number;
  waitlisted: number;
  cancelled: number;
  invited: number;
  attended: number;
  capacity: number | null;
  seats_remaining: number | null;
  capacity_utilization: number | null;
}

export interface EventReportPayload {
  event: string;
  metrics: EventReportMetrics;
  categories: Array<{
    category: string;
    registrations: number;
    confirmed: number;
    waitlisted: number;
    cancelled: number;
    attended: number;
  }>;
  filtered_count: number;
  results: Array<{
    id: string;
    participant_name: string;
    email: string;
    organization: string;
    status: string;
    display_category: string;
    attended: boolean;
    created_at: string;
  }>;
}

export async function listSiteEventRegistrations(
  site: number,
  eventId: string,
  query: ParticipantListQuery = {},
): Promise<ActionResult<EventRegistrationInventory>> {
  try {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    const data = await (await api()).get<EventRegistrationInventory>(
      `${base(site)}${eventId}/registrations/${suffix}`,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createSiteEventParticipant(
  site: number,
  eventId: string,
  body: ParticipantCreateInput,
): Promise<ActionResult<EventRegistrationRow>> {
  try {
    const data = await (await api()).post<EventRegistrationRow>(
      `${base(site)}${eventId}/registrations/`,
      body,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateSiteEventParticipant(
  site: number,
  eventId: string,
  registrationId: string,
  body: Partial<Pick<EventRegistrationRow, "participant_name" | "organization" | "phone" | "display_category">>,
): Promise<ActionResult<EventRegistrationRow>> {
  try {
    const data = await (await api()).patch<EventRegistrationRow>(
      `${base(site)}${eventId}/registrations/${registrationId}/`,
      body,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function actOnSiteEventParticipant(
  site: number,
  eventId: string,
  registrationId: string,
  action: "confirm" | "cancel" | "delete",
): Promise<ActionResult<EventRegistrationRow>> {
  try {
    const data = await (await api()).post<EventRegistrationRow>(
      `${base(site)}${eventId}/registrations/${registrationId}/`,
      {action},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function fetchSiteEventParticipantBadge(
  site: number,
  eventId: string,
  registrationId: string,
): Promise<ActionResult<ParticipantBadge>> {
  try {
    const data = await (await api()).get<ParticipantBadge>(
      `${base(site)}${eventId}/registrations/${registrationId}/badge/`,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function exportSiteEventParticipantsCsv(
  site: number,
  eventId: string,
): Promise<ActionResult<{filename: string; content: string}>> {
  try {
    const token = (await getAccessToken()) ?? undefined;
    const baseUrl = process.env.API_BASE_URL ?? "http://backend:8000/api";
    const response = await serverApiFetch(
      `${baseUrl}/v1/sites/${site}/events/${eventId}/registrations/export/`,
      {
        headers: token ? {Authorization: `Bearer ${token}`} : undefined,
      },
    );
    if (!response.ok) {
      return {ok: false, error: {message: `Export failed (${response.status})`}};
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const content = await response.text();
    return {ok: true, data: {filename: match?.[1] || "participants.csv", content}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function checkInSiteEventParticipant(
  site: number,
  eventId: string,
  registrationId: string,
  options: {override?: boolean; notes?: string} = {},
): Promise<ActionResult<AttendanceRow>> {
  try {
    const data = await (await api()).post<AttendanceRow>(
      `${base(site)}${eventId}/attendance/check-in/`,
      {registration_id: registrationId, ...options},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function scanSiteEventCheckIn(
  site: number,
  eventId: string,
  token: string,
  options: {override?: boolean; notes?: string} = {},
): Promise<ActionResult<AttendanceRow>> {
  try {
    const data = await (await api()).post<AttendanceRow>(
      `${base(site)}${eventId}/attendance/scan/`,
      {token, ...options},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function fetchSiteEventReport(
  site: number,
  eventId: string,
  query: {
    status?: string;
    category?: string;
    attended?: string;
    date_from?: string;
    date_to?: string;
  } = {},
): Promise<ActionResult<EventReportPayload>> {
  try {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    const data = await (await api()).get<EventReportPayload>(`${base(site)}${eventId}/report/${suffix}`);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function exportSiteEventReportCsv(
  site: number,
  eventId: string,
  query: {
    status?: string;
    category?: string;
    attended?: string;
    date_from?: string;
    date_to?: string;
  } = {},
): Promise<ActionResult<{filename: string; content: string}>> {
  try {
    const token = (await getAccessToken()) ?? undefined;
    const baseUrl = process.env.API_BASE_URL ?? "http://backend:8000/api";
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    const response = await serverApiFetch(
      `${baseUrl}/v1/sites/${site}/events/${eventId}/report/export/${suffix}`,
      {headers: token ? {Authorization: `Bearer ${token}`} : undefined},
    );
    if (!response.ok) {
      return {ok: false, error: {message: `Report export failed (${response.status})`}};
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const content = await response.text();
    return {ok: true, data: {filename: match?.[1] || "attendance-report.csv", content}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
