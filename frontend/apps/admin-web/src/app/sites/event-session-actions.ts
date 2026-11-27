"use server";
import {createApiClient} from "@uog/api-client";
import type {EventSessionInput, EventSessionListResult, EventSessionRecord} from "@uog/types";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

async function api() {
  return createApiClient({
    fetchFn: serverApiFetch,
    baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api",
    accessToken: (await getAccessToken()) ?? undefined,
  });
}

function base(site: number, eventId: string) {
  return `/v1/sites/${site}/events/${eventId}/sessions/`;
}

export async function listEventSessions(
  site: number,
  eventId: string,
  query: {search?: string; day?: string} = {},
): Promise<ActionResult<EventSessionListResult>> {
  try {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.day) params.set("day", query.day);
    const suffix = params.toString() ? `?${params}` : "";
    const data = await (await api()).get<EventSessionListResult>(`${base(site, eventId)}${suffix}`);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createEventSession(
  site: number,
  eventId: string,
  payload: EventSessionInput,
): Promise<ActionResult<{data: EventSessionRecord; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<EventSessionRecord>(base(site, eventId), payload);
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateEventSession(
  site: number,
  eventId: string,
  sessionId: string,
  etag: string,
  payload: EventSessionInput,
): Promise<ActionResult<{data: EventSessionRecord; etag: string | null}>> {
  try {
    const response = await (await api()).patchDetailed<EventSessionRecord>(
      `${base(site, eventId)}${sessionId}/`,
      payload,
      {ifMatch: etag},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function removeEventSession(
  site: number,
  eventId: string,
  sessionId: string,
  etag: string,
): Promise<ActionResult<EventSessionRecord>> {
  try {
    const data = await (await api()).delDetailed<EventSessionRecord>(
      `${base(site, eventId)}${sessionId}/`,
      {ifMatch: etag},
    );
    return {ok: true, data: data.data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function duplicateEventSession(
  site: number,
  eventId: string,
  sessionId: string,
): Promise<ActionResult<{data: EventSessionRecord; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<EventSessionRecord>(
      `${base(site, eventId)}${sessionId}/duplicate/`,
      {},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function reorderEventSessions(
  site: number,
  eventId: string,
  eventEtag: string,
  order: string[],
): Promise<ActionResult<{data: EventSessionListResult; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<EventSessionListResult>(
      `${base(site, eventId)}reorder/`,
      {order},
      {headers: {"If-Match": eventEtag}},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
