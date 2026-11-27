"use server";

import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export type UpdateSeverity = "INFO" | "IMPORTANT" | "URGENT";
export type UpdateStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

export interface EventUpdateRow {
  id: string;
  event: string;
  title: string;
  body: string;
  severity: UpdateSeverity | string;
  status: UpdateStatus | string;
  pinned: boolean;
  published_at: string | null;
  unpublished_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

async function api() {
  return createApiClient({
    fetchFn: serverApiFetch,
    baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api",
    accessToken: (await getAccessToken()) ?? undefined,
  });
}

function base(site: number, eventId: string) {
  return `/v1/sites/${site}/events/${eventId}/updates/`;
}

export async function listEventUpdates(
  site: number,
  eventId: string,
): Promise<ActionResult<EventUpdateRow[]>> {
  try {
    const data = await (await api()).get<EventUpdateRow[]>(base(site, eventId));
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createEventUpdate(
  site: number,
  eventId: string,
  body: {title: string; body?: string; severity?: UpdateSeverity; pinned?: boolean},
): Promise<ActionResult<EventUpdateRow>> {
  try {
    const data = await (await api()).post<EventUpdateRow>(base(site, eventId), body);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateEventUpdate(
  site: number,
  eventId: string,
  updateId: string,
  body: Partial<Pick<EventUpdateRow, "title" | "body" | "severity" | "pinned" | "version">>,
): Promise<ActionResult<EventUpdateRow>> {
  try {
    const data = await (await api()).patch<EventUpdateRow>(
      `${base(site, eventId)}${updateId}/`,
      body,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function actOnEventUpdate(
  site: number,
  eventId: string,
  updateId: string,
  action: "publish" | "unpublish",
  version?: number,
): Promise<ActionResult<EventUpdateRow>> {
  try {
    const data = await (await api()).post<EventUpdateRow>(
      `${base(site, eventId)}${updateId}/action/`,
      {action, ...(version != null ? {version} : {})},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
