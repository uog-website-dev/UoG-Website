/** Site-owned public metadata; internal storage identity is intentionally absent. */
export type MediaStatus = "PENDING" | "READY" | "REJECTED" | "ARCHIVED";
export interface MediaAsset {
  id: string;
  site: number;
  original_filename: string;
  display_name: string;
  categories: string[];
  detected_mime: string;
  content_type: string;
  byte_count: number;
  checksum: string;
  status: MediaStatus;
  processing_state: "PROCESSING" | "READY" | "REJECTED" | "ARCHIVED" | "FAILED";
  thumbnail_status: "NOT_GENERATED" | "NOT_APPLICABLE" | "PROCESSING" | "READY" | "FAILED" | "UNAVAILABLE";
  thumbnail_url: string | null;
  processing_attempts: number;
  processing_error_code: string;
  width: number | null;
  height: number | null;
  alt_text: string;
  created_by: number;
  updated_by: number;
  created_at: string;
  updated_at: string;
}
export interface MediaListQuery {
  search?: string;
  status?: MediaStatus;
  type?: "image" | "document";
  content_type?: string;
  ready_images?: boolean;
  ordering?: "created_at" | "-created_at" | "original_filename" | "-original_filename";
  page?: number;
  page_size?: number;
}
export interface MediaMetadataPatch {
  display_name?: string;
  categories?: string[];
  alt_text?: string;
  status?: MediaStatus;
}

export interface MediaReferenceInventory {
  asset_id: string;
  references: { id: string; scope: "DRAFT" | "PUBLIC" | "MANUAL" | "REVISION"; page_id: string; revision_id: number; publication_id: number | null; node_id: string; field_path: string; repeater_item_id: string; detachable: boolean }[];
}
export interface MediaDeletion { asset_id: string; state: "QUEUED" | "RETRY" | "DONE"; attempts: number; deleted_at: string }
