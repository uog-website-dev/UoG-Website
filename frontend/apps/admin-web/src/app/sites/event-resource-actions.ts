"use server";

import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";
import {listSiteDocuments, type SiteDocument} from "@/app/sites/document-actions";

export type ResourceVisibility = "DRAFT" | "PUBLIC" | "REGISTERED_ONLY";
export type ResourceCategory = "BROCHURE" | "SLIDES" | "AGENDA" | "HANDOUT" | "OTHER";

export interface EventResourceRow {
  id: string;
  event: string;
  session: string | null;
  session_title?: string | null;
  document: string;
  document_title?: string;
  title: string;
  description: string;
  category: ResourceCategory | string;
  sort_order: number;
  visibility: ResourceVisibility | string;
  published_at: string | null;
  file_type: string | null;
  original_filename: string | null;
  file_size: number | null;
  file_ready: boolean;
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
  return `/v1/sites/${site}/events/${eventId}/resources/`;
}

export async function listEventResources(
  site: number,
  eventId: string,
): Promise<ActionResult<EventResourceRow[]>> {
  try {
    const data = await (await api()).get<EventResourceRow[]>(base(site, eventId));
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createEventResource(
  site: number,
  eventId: string,
  body: {
    document: string;
    title: string;
    description?: string;
    category?: string;
    session?: string | null;
    visibility?: ResourceVisibility;
  },
): Promise<ActionResult<EventResourceRow>> {
  try {
    const data = await (await api()).post<EventResourceRow>(base(site, eventId), body);
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateEventResource(
  site: number,
  eventId: string,
  resourceId: string,
  body: Partial<Pick<EventResourceRow, "title" | "description" | "category" | "session">>,
): Promise<ActionResult<EventResourceRow>> {
  try {
    const data = await (await api()).patch<EventResourceRow>(
      `${base(site, eventId)}${resourceId}/`,
      body,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function setEventResourceVisibility(
  site: number,
  eventId: string,
  resourceId: string,
  visibility: ResourceVisibility,
): Promise<ActionResult<EventResourceRow>> {
  try {
    const data = await (await api()).post<EventResourceRow>(
      `${base(site, eventId)}${resourceId}/visibility/`,
      {visibility},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function removeEventResource(
  site: number,
  eventId: string,
  resourceId: string,
): Promise<ActionResult<null>> {
  try {
    await (await api()).delete(`${base(site, eventId)}${resourceId}/`);
    return {ok: true, data: null};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function listSelectableDocuments(
  site: number,
): Promise<ActionResult<SiteDocument[]>> {
  const result = await listSiteDocuments(site, {page_size: 100});
  if (!result.ok) return result;
  return {ok: true, data: result.data.results.filter((row) => Boolean(row.file_reference))};
}
