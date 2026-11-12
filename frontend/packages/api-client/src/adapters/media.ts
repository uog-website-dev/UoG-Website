import type { MediaAsset, MediaDeletion, MediaReferenceInventory, MediaListQuery, MediaMetadataPatch, PaginatedResponse } from "@uog/types";
import { createApiClient } from "../client";
import type { ApiClientOptions } from "../client";
import { buildQueryString, withQuery } from "../query";

export interface MediaAdapter {
  list(siteId: number, query?: MediaListQuery): Promise<PaginatedResponse<MediaAsset>>;
  readyImages(siteId: number, query?: Omit<MediaListQuery, "status" | "type" | "ready_images">): Promise<PaginatedResponse<MediaAsset>>;
  detail(siteId: number, assetId: string): Promise<MediaAsset>;
  inventory(siteId: number, assetId: string): Promise<MediaReferenceInventory>;
  remove(siteId: number, assetId: string): Promise<MediaDeletion>;
  deletion(siteId: number, assetId: string): Promise<MediaDeletion>;
  update(siteId: number, assetId: string, changes: MediaMetadataPatch): Promise<MediaAsset>;
}

export function createLiveMediaAdapter(options: ApiClientOptions): MediaAdapter {
  const api = createApiClient(options);
  const root = (siteId: number) => {
    if (!Number.isSafeInteger(siteId) || siteId < 1) throw new Error("A positive Site ID is required.");
    return `/v1/sites/${siteId}/assets/`;
  };
  const list: MediaAdapter["list"] = (siteId, query = {}) => api.get(withQuery(root(siteId), buildQueryString({
    search: query.search, status: query.status, type: query.type, content_type: query.content_type,
    ready_images: query.ready_images, ordering: query.ordering, page: query.page, page_size: query.page_size,
  })));
  return {
    list,
    readyImages: (siteId, query = {}) => list(siteId, { ...query, ready_images: true }),
    detail: (siteId, id) => api.get(`${root(siteId)}${encodeURIComponent(id)}/`),
    inventory: (siteId,id) => api.get(`${root(siteId)}${encodeURIComponent(id)}/references/`),
    remove: (siteId,id) => api.delete(`${root(siteId)}${encodeURIComponent(id)}/`),
    deletion: (siteId,id) => api.get(`${root(siteId)}${encodeURIComponent(id)}/deletion/`),
    update: (siteId, id, changes) => {
      if (Object.keys(changes).some((key) => !["display_name", "categories", "alt_text", "status"].includes(key))) throw new Error("Only media name, categories, alt text and lifecycle status are writable.");
      return api.patch(`${root(siteId)}${encodeURIComponent(id)}/`, changes);
    },
  };
}
