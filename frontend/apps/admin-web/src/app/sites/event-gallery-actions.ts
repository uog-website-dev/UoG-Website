"use server";

import {createApiClient} from "@uog/api-client";
import {getAccessToken} from "@/access-token";
import {serverApiFetch} from "@/performance/server-fetch";
import {serializeApiError} from "@/organizations/contract";
import type {ActionResult} from "@/organizations/contract";

export interface EventGalleryImageRow {
  id: string;
  event: string;
  media_asset: string;
  session: string | null;
  session_title?: string | null;
  caption: string;
  alt_text: string;
  sort_order: number;
  is_published: boolean;
  usage_consent: boolean;
  published_at: string | null;
  version: number;
  thumbnail_url: string;
  display_url: string;
  original_filename?: string;
  content_type?: string;
  byte_count?: number;
  asset_ready?: boolean;
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
  return `/v1/sites/${site}/events/${eventId}/gallery/`;
}

export async function listEventGallery(
  site: number,
  eventId: string,
): Promise<ActionResult<EventGalleryImageRow[]>> {
  try {
    const data = await (await api()).get<EventGalleryImageRow[]>(base(site, eventId));
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function createEventGalleryImages(
  site: number,
  eventId: string,
  items: Array<{
    media_asset: string;
    caption?: string;
    alt_text?: string;
    session?: string | null;
    is_published?: boolean;
    usage_consent: boolean;
  }>,
): Promise<ActionResult<EventGalleryImageRow[]>> {
  try {
    const data = await (await api()).post<EventGalleryImageRow[]>(base(site, eventId), {items});
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function updateEventGalleryImage(
  site: number,
  eventId: string,
  imageId: string,
  body: Partial<Pick<EventGalleryImageRow, "caption" | "alt_text" | "session" | "sort_order" | "version">>,
): Promise<ActionResult<EventGalleryImageRow>> {
  try {
    const data = await (await api()).patch<EventGalleryImageRow>(
      `${base(site, eventId)}${imageId}/`,
      body,
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function publishEventGalleryImage(
  site: number,
  eventId: string,
  imageId: string,
  isPublished: boolean,
  version?: number,
): Promise<ActionResult<EventGalleryImageRow>> {
  try {
    const data = await (await api()).post<EventGalleryImageRow>(
      `${base(site, eventId)}${imageId}/publish/`,
      {is_published: isPublished, ...(version != null ? {version} : {})},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function detachEventGalleryImage(
  site: number,
  eventId: string,
  imageId: string,
): Promise<ActionResult<null>> {
  try {
    await (await api()).delete(`${base(site, eventId)}${imageId}/`);
    return {ok: true, data: null};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}

export async function reorderEventGallery(
  site: number,
  eventId: string,
  order: string[],
  versions?: Record<string, number>,
): Promise<ActionResult<EventGalleryImageRow[]>> {
  try {
    const data = await (await api()).post<EventGalleryImageRow[]>(
      `${base(site, eventId)}reorder/`,
      {order, ...(versions ? {versions} : {})},
    );
    return {ok: true, data};
  } catch (cause) {
    return {ok: false, error: serializeApiError(cause)};
  }
}
