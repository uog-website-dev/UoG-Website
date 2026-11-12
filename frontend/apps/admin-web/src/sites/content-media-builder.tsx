"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  SiteImageField,
  assetIdFromImageRef,
  imageRefForAsset,
  type SiteImageSelection,
} from "@/sites/site-image-field";

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

interface ImageBlockEditorProps {
  siteId: number;
  value: ImageBlockValue;
  onChange: (next: ImageBlockValue) => void;
  canUpload?: boolean;
  disabled?: boolean;
}

/** Standalone Image widget field — only this node updates. */
export function ImageBlockEditor({ siteId, value, onChange, canUpload, disabled }: ImageBlockEditorProps) {
  const selection: SiteImageSelection = {
    assetId: assetIdFromImageRef(value.ref, siteId),
    alt: value.alt,
  };
  return (
    <SiteImageField
      siteId={siteId}
      label="Image"
      value={selection}
      canUpload={canUpload}
      disabled={disabled}
      optional
      onChange={(next) => onChange({
        ...value,
        ref: next.assetId ? imageRefForAsset(siteId, next.assetId) : `sites/${siteId}/image`,
        alt: next.alt,
      })}
    />
  );
}

interface RepeaterMediaEditorProps {
  siteId: number;
  kind: "slider" | "gallery";
  items: MediaRepeaterItem[];
  onChange: (items: MediaRepeaterItem[]) => void;
  canUpload?: boolean;
  disabled?: boolean;
}

/**
 * Per-item Slider/Gallery image fields. Changing one slide/image leaves the
 * others untouched; reorder keeps asset IDs with their repeater entries.
 */
export function RepeaterMediaEditor({
  siteId,
  kind,
  items,
  onChange,
  canUpload,
  disabled,
}: RepeaterMediaEditorProps) {
  const label = kind === "slider" ? "Slide" : "Gallery image";
  const updateItem = (index: number, patch: Partial<MediaRepeaterItem>) => {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row!);
    onChange(next);
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {items.map((item, index) => (
        <Paper key={item.id} variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.5 }}>
          <Typography variant="caption">{label} {index + 1}</Typography>
          <SiteImageField
            siteId={siteId}
            label={`${label} ${index + 1} image`}
            value={{ assetId: item.asset_id || null, alt: item.alt }}
            canUpload={canUpload}
            disabled={disabled}
            optional
            onChange={(next) => updateItem(index, { asset_id: next.assetId ?? "", alt: next.alt })}
          />
          <TextField
            label={`${label} ${index + 1} caption`}
            value={item.caption ?? ""}
            onChange={(event) => updateItem(index, { caption: event.target.value || undefined })}
            disabled={disabled}
            inputProps={{ maxLength: 400, "aria-label": `${label} ${index + 1} caption` }}
          />
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button aria-label={`Move ${label.toLowerCase()} ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>Move up</Button>
            <Button aria-label={`Move ${label.toLowerCase()} ${index + 1} down`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>Move down</Button>
            <Button
              color="error"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              disabled={disabled || items.length <= 1}
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove entry
            </Button>
          </Box>
        </Paper>
      ))}
      <Button
        disabled={disabled || items.length >= 50}
        onClick={() => onChange([...items, { id: newId(), asset_id: "", alt: "Describe this image" }])}
      >
        Add {kind === "slider" ? "slide" : "gallery image"}
      </Button>
    </Box>
  );
}

interface MediaBlockEditorProps {
  siteId: number;
  value: MediaBlockValue;
  onChange: (next: MediaBlockValue) => void;
  canUpload?: boolean;
  disabled?: boolean;
}

/** Shared CMS + Visual Builder surface for Image, Slider and Gallery nodes. */
export function MediaBlockEditor({ siteId, value, onChange, canUpload, disabled }: MediaBlockEditorProps) {
  if (value.type === "image") {
    return <ImageBlockEditor siteId={siteId} value={value} onChange={onChange} canUpload={canUpload} disabled={disabled} />;
  }
  const items = value.type === "slider" ? value.slides : value.images;
  return (
    <RepeaterMediaEditor
      siteId={siteId}
      kind={value.type}
      items={items}
      canUpload={canUpload}
      disabled={disabled}
      onChange={(nextItems) => {
        if (value.type === "slider") onChange({ ...value, slides: nextItems });
        else onChange({ ...value, images: nextItems });
      }}
    />
  );
}
