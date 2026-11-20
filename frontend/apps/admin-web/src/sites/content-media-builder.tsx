"use client";

export interface MediaRepeaterItem {
  id: string;
  asset_id: string;
  alt: string;
  caption?: string;
}

export interface ImageBlockValue {
  type: "image";
  id: string;
  ref: string;
  alt: string;
  caption?: string;
}

export interface SliderBlockValue {
  type: "slider";
  id: string;
  slides: MediaRepeaterItem[];
}

export interface GalleryBlockValue {
  type: "gallery";
  id: string;
  images: MediaRepeaterItem[];
}

export type MediaBlockValue = ImageBlockValue | SliderBlockValue | GalleryBlockValue;

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyImageBlock(siteId: number): ImageBlockValue {
  return { type: "image", id: newId(), ref: `sites/${siteId}/image`, alt: "Describe this image" };
}

export function createEmptySliderBlock(): SliderBlockValue {
  return { type: "slider", id: newId(), slides: [{ id: newId(), asset_id: "", alt: "Describe this image" }] };
}

export function createEmptyGalleryBlock(): GalleryBlockValue {
  return { type: "gallery", id: newId(), images: [{ id: newId(), asset_id: "", alt: "Describe this image" }] };
}

export function createEmptyMediaRepeaterItem(): MediaRepeaterItem {
  return { id: newId(), asset_id: "", alt: "Describe this image" };
}

export function parseMediaBlock(raw: unknown): MediaBlockValue | null {
  if (!raw || typeof raw !== "object") return null;
  const block = raw as Record<string, unknown>;
  if (block.type === "image" && typeof block.ref === "string") {
    return {
      type: "image",
      id: typeof block.id === "string" ? block.id : newId(),
      ref: block.ref,
      alt: typeof block.alt === "string" ? block.alt : "",
      ...(typeof block.caption === "string" ? { caption: block.caption } : {}),
    };
  }
  if (block.type === "slider" && Array.isArray(block.slides)) {
    return {
      type: "slider",
      id: typeof block.id === "string" ? block.id : newId(),
      slides: normalizeItems(block.slides),
    };
  }
  if (block.type === "gallery" && Array.isArray(block.images)) {
    return {
      type: "gallery",
      id: typeof block.id === "string" ? block.id : newId(),
      images: normalizeItems(block.images),
    };
  }
  return null;
}

function normalizeItems(value: unknown[]): MediaRepeaterItem[] {
  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      id: typeof row.id === "string" ? row.id : newId(),
      asset_id: typeof row.asset_id === "string" ? row.asset_id : "",
      alt: typeof row.alt === "string" ? row.alt : "",
      caption: typeof row.caption === "string" ? row.caption : undefined,
    };
  });
}
