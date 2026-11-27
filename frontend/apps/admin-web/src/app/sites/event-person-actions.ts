"use server";
import {createApiClient} from "@uog/api-client";
import type {
  EventPersonInput,
  EventPersonRecord,
  SessionPersonAssignment,
  SessionPersonRole,
} from "@uog/types";
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

function peopleBase(site: number, eventId: string) {
  return `/v1/sites/${site}/events/${eventId}/people/`;
}

function sessionPeopleBase(site: number, eventId: string, sessionId: string) {
  return `/v1/sites/${site}/events/${eventId}/sessions/${sessionId}/people/`;
}

export async function listEventPeople(
  site: number,
  eventId: string,
  search = "",
): Promise<ActionResult<{results: EventPersonRecord[]}>> {
  try {
    const suffix = search ? `?search=${encodeURIComponent(search)}` : "";
    const data = await (await api()).get<{results: EventPersonRecord[]}>(`${peopleBase(site, eventId)}${suffix}`);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createEventPerson(
  site: number,
  eventId: string,
  payload: EventPersonInput,
): Promise<ActionResult<{data: EventPersonRecord; etag: string | null}>> {
  try {
    const response = await (await api()).postDetailed<EventPersonRecord>(peopleBase(site, eventId), payload);
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateEventPerson(
  site: number,
  eventId: string,
  personId: string,
  etag: string,
  payload: EventPersonInput,
): Promise<ActionResult<{data: EventPersonRecord; etag: string | null}>> {
  try {
    const response = await (await api()).patchDetailed<EventPersonRecord>(
      `${peopleBase(site, eventId)}${personId}/`,
      payload,
      {ifMatch: etag},
    );
    return {ok: true, data: {data: response.data, etag: response.etag}};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function removeEventPerson(
  site: number,
  eventId: string,
  personId: string,
  etag: string,
): Promise<ActionResult<EventPersonRecord>> {
  try {
    const data = await (await api()).delDetailed<EventPersonRecord>(
      `${peopleBase(site, eventId)}${personId}/`,
      {ifMatch: etag},
    );
    return {ok: true, data: data.data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function listSessionPeople(
  site: number,
  eventId: string,
  sessionId: string,
): Promise<ActionResult<{results: SessionPersonAssignment[]}>> {
  try {
    const data = await (await api()).get<{results: SessionPersonAssignment[]}>(
      sessionPeopleBase(site, eventId, sessionId),
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function assignSessionPerson(
  site: number,
  eventId: string,
  sessionId: string,
  payload: {person: string; role?: SessionPersonRole; sort_order?: number},
): Promise<ActionResult<SessionPersonAssignment>> {
  try {
    const data = await (await api()).post<SessionPersonAssignment>(
      sessionPeopleBase(site, eventId, sessionId),
      payload,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function unassignSessionPerson(
  site: number,
  eventId: string,
  sessionId: string,
  assignmentId: string,
): Promise<ActionResult<null>> {
  try {
    await (await api()).delete(sessionPeopleBase(site, eventId, sessionId) + `${assignmentId}/`);
    return {ok: true, data: null};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
