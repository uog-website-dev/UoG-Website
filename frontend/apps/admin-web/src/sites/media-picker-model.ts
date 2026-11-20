import type { MediaAssetRecord } from "@/app/sites/media-actions";

export interface MediaPickerResult {
  assetId: string;
  originalFilename: string;
  altText: string;
  contentType: string;
  byteCount: number;
}

export type MediaPickerUseCase = "ready_image";

export function isEligibleReadyImage(asset: MediaAssetRecord, siteId: number): boolean {
  return (
    asset.site === siteId
    && asset.status === "READY"
    && asset.processing_state === "READY"
    && (asset.detected_mime.startsWith("image/") || asset.content_type.startsWith("image/"))
    && !["PROCESSING", "FAILED", "UNAVAILABLE"].includes(asset.thumbnail_status)
  );
}

export function toPickerResult(asset: MediaAssetRecord): MediaPickerResult {
  return {
    assetId: asset.id,
    originalFilename: asset.original_filename,
    altText: asset.alt_text,
    contentType: asset.content_type || asset.detected_mime,
    byteCount: asset.byte_count,
  };
}
