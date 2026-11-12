"use server";
import { createApiClient, createLiveMediaAdapter } from "@uog/api-client";
import type { MediaAsset, MediaDeletion, MediaReferenceInventory, MediaListQuery, MediaMetadataPatch, PaginatedResponse } from "@uog/types";
import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

export type MediaAssetRecord = MediaAsset;
export interface UploadPolicy { image_max_bytes: number; text_max_bytes: number; pdf_max_bytes: number; mime_types: string[] }
async function client() {
  return createApiClient({ baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api", accessToken: (await getAccessToken()) ?? undefined });
}
async function adapter() {
  return createLiveMediaAdapter({ baseUrl: process.env.API_BASE_URL ?? "http://backend:8000/api", accessToken: (await getAccessToken()) ?? undefined });
}
export async function listSiteMedia(siteId: number, query: MediaListQuery = {}): Promise<ActionResult<PaginatedResponse<MediaAssetRecord>>> {
  try { return { ok: true, data: await (await adapter()).list(siteId, query) }; }
  catch (cause) { return { ok: false, error: serializeApiError(cause) }; }
}
export async function getSiteMedia(siteId: number, assetId: string): Promise<ActionResult<MediaAssetRecord>> {
  try { return { ok: true, data: await (await adapter()).detail(siteId, assetId) }; }
  catch (cause) { return { ok: false, error: serializeApiError(cause) }; }
}
export async function updateSiteMedia(siteId: number, assetId: string, changes: MediaMetadataPatch): Promise<ActionResult<MediaAssetRecord>> {
  try { return { ok: true, data: await (await adapter()).update(siteId, assetId, changes) }; }
  catch (cause) { return { ok: false, error: serializeApiError(cause) }; }
}
export async function getMediaUploadPolicy(siteId: number): Promise<ActionResult<UploadPolicy>> {
  try { return { ok: true, data: await (await client()).get(`/v1/sites/${siteId}/assets/upload-policy/`) }; }
  catch (cause) { return { ok: false, error: serializeApiError(cause) }; }
}

export async function getMediaReferences(siteId: number, assetId: string): Promise<ActionResult<MediaReferenceInventory>> {
  try { return { ok: true, data: await (await adapter()).inventory(siteId,assetId) }; }
  catch(cause) { return { ok: false, error: serializeApiError(cause) }; }
}
export async function removeSiteMedia(siteId: number, assetId: string): Promise<ActionResult<MediaDeletion>> {
  try { return { ok: true, data: await (await adapter()).remove(siteId,assetId) }; }
  catch(cause) { return { ok: false, error: serializeApiError(cause) }; }
}
