"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { getSiteMedia } from "@/app/sites/media-actions";
import { APP_BASE_PATH } from "@/base-path";
import { MediaPickerDialog, type MediaPickerResult, isEligibleReadyImage } from "@/sites/media-picker";

export interface SiteImageSelection {
  assetId: string | null;
  alt: string;
}

interface SiteImageFieldProps {
  siteId: number;
  label: string;
  value: SiteImageSelection;
  onChange: (next: SiteImageSelection) => void;
  /** When true, show a clear Remove image control. */
  optional?: boolean;
  canUpload?: boolean;
  disabled?: boolean;
  helperText?: string;
}

export function imageRefForAsset(siteId: number, assetId: string): string {
  return `sites/${siteId}/assets/${assetId}`;
}

export function assetIdFromImageRef(ref: string | undefined, siteId: number): string | null {
  if (!ref) return null;
  const match = ref.trim().toLowerCase().match(/^sites\/([0-9]+)\/assets\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
  if (!match || Number(match[1]) !== siteId) return null;
  return match[2]!.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/, "$1-$2-$3-$4-$5");
}

/**
 * One Site-filtered image selection contract for Image widgets and
 * per-item Slider/Gallery repeater entries. Site changes remount and clear.
 */
export function SiteImageField(props: SiteImageFieldProps) {
  return <SiteImageFieldInner key={props.siteId} {...props} />;
}

function SiteImageFieldInner({
  siteId,
  label,
  value,
  onChange,
  optional = false,
  canUpload = false,
  disabled = false,
  helperText = "Describe the image for screen readers. Prefer the library alt text when it fits.",
}: SiteImageFieldProps) {
  const invokeRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  useEffect(() => {
    let ignore = false;
    if (!value.assetId) {
      setDisplayName(null);
      setEligibilityError(null);
      return;
    }
    setLoadingMeta(true);
    void getSiteMedia(siteId, value.assetId).then((response) => {
      if (ignore) return;
      setLoadingMeta(false);
      if (!response.ok) {
        setDisplayName(value.assetId);
        setEligibilityError("Asset metadata could not be loaded. The draft selection is kept until you save or change it.");
        return;
      }
      setDisplayName(response.data.original_filename);
      if (!isEligibleReadyImage(response.data, siteId)) {
        setEligibilityError("This selected asset is no longer eligible. Change the image or fix the asset before saving.");
      } else {
        setEligibilityError(null);
      }
    });
    return () => { ignore = true; };
  }, [siteId, value.assetId]);

  const applyPick = (result: MediaPickerResult) => {
    onChange({
      assetId: result.assetId,
      alt: value.alt.trim() ? value.alt : (result.altText || value.alt),
    });
    setDisplayName(result.originalFilename);
    setEligibilityError(null);
    setOpen(false);
  };

  return (
    <Box component="section" aria-label={label} sx={{ display: "grid", gap: 1.5, minWidth: 0 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {value.assetId ? (
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Box
            component="img"
            width={96}
            height={96}
            alt={value.alt || displayName || "Selected image"}
            src={`${APP_BASE_PATH}/sites/${siteId}/media/${value.assetId}/image?variant=thumbnail`}
            sx={{ objectFit: "contain", border: 1, borderColor: "divider" }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ overflowWrap: "anywhere" }}>
              {loadingMeta ? "Loading image metadata…" : displayName || value.assetId}
            </Typography>
            <Typography variant="body2">Asset ID: {value.assetId}</Typography>
          </Box>
        </Box>
      ) : (
        <Typography color="text.secondary">No image selected.</Typography>
      )}
      {eligibilityError ? <Alert severity="warning" role="status">{eligibilityError}</Alert> : null}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button
          ref={invokeRef}
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {value.assetId ? "Change image" : "Choose image"}
        </Button>
        {optional && value.assetId ? (
          <Button
            color="warning"
            disabled={disabled}
            onClick={() => onChange({ assetId: null, alt: value.alt })}
          >
            Remove image
          </Button>
        ) : null}
      </Box>
      <TextField
        label="Alt text"
        value={value.alt}
        onChange={(event) => onChange({ assetId: value.assetId, alt: event.target.value })}
        disabled={disabled}
        multiline
        minRows={2}
        inputProps={{ maxLength: 255, "aria-label": `${label} alt text` }}
        helperText={helperText}
      />
      <MediaPickerDialog
        open={open}
        siteId={siteId}
        returnFocusRef={invokeRef}
        canUpload={canUpload}
        onCancel={() => setOpen(false)}
        onConfirm={applyPick}
      />
    </Box>
  );
}
