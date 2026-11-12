"use client";

import { useEffect, useId, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { getSiteMedia } from "@/app/sites/media-actions";
import type { MediaAssetRecord } from "@/app/sites/media-actions";
import { MediaLibrary } from "@/sites/media-library";

/** Stable picker result: Site-owned asset ID plus display metadata for the editor. */
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

export async function confirmReadyImageSelection(
  siteId: number,
  assetId: string,
): Promise<{ ok: true; data: MediaPickerResult } | { ok: false; message: string }> {
  const response = await getSiteMedia(siteId, assetId);
  if (!response.ok) {
    return { ok: false, message: response.error.message || "Asset eligibility could not be verified." };
  }
  if (!isEligibleReadyImage(response.data, siteId)) {
    return {
      ok: false,
      message: "This asset is no longer an eligible ready image for this Site. Your draft selection was not applied.",
    };
  }
  return { ok: true, data: toPickerResult(response.data) };
}

interface MediaPickerDialogProps {
  open: boolean;
  siteId: number;
  /** Invoking control that regains focus after cancel or confirm. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  useCase?: MediaPickerUseCase;
  canUpload?: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (result: MediaPickerResult) => void;
}

/**
 * Shared modal picker for CMS and Visual Builder.
 * Filters to ready same-Site images, re-checks eligibility on confirm, and
 * restores focus to the invoking control on Escape/cancel or success.
 */
export function MediaPickerDialog(props: MediaPickerDialogProps) {
  return <MediaPickerDialogInner key={`${props.siteId}:${props.open}`} {...props} />;
}

function MediaPickerDialogInner({
  open,
  siteId,
  returnFocusRef,
  useCase = "ready_image",
  canUpload = false,
  title = "Choose a ready image",
  onCancel,
  onConfirm,
}: MediaPickerDialogProps) {
  const titleId = useId();
  const [candidate, setCandidate] = useState<MediaAssetRecord | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedByAction = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => {
    if (!open) {
      setCandidate(null);
      setConfirming(false);
      setError(null);
      closedByAction.current = false;
    }
  }, [open, siteId]);

  const restoreFocus = () => {
    window.setTimeout(() => returnFocusRef?.current?.focus(), 0);
  };

  const cancel = () => {
    generation.current += 1;
    closedByAction.current = true;
    onCancel();
    restoreFocus();
  };

  const confirm = async (asset: MediaAssetRecord) => {
    if (confirming) return;
    setConfirming(true);
    setError(null);
    const requestGeneration = ++generation.current;
    const current = () => mounted.current && generation.current === requestGeneration && open;
    try {
      const checked = await confirmReadyImageSelection(siteId, asset.id);
      if (!current()) return;
      if (!checked.ok) {
        setError(checked.message);
        setCandidate(asset);
        return;
      }
      closedByAction.current = true;
      onConfirm(checked.data);
      restoreFocus();
    } catch {
      if (current()) setError("The image could not be verified. Check your connection and select it again to retry.");
    } finally {
      if (current()) setConfirming(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_, reason) => {
        if (reason === "backdropClick" && confirming) return;
        cancel();
      }}
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      disableRestoreFocus
      TransitionProps={{
        onExited: () => {
          if (!closedByAction.current) restoreFocus();
        },
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Only ready images owned by this Site can be selected. Alt text from the library is suggested for accessibility; adjust it on the field after choosing.
        </Typography>
        {useCase === "ready_image" ? (
          <Box key={siteId}>
            <MediaLibrary
              siteId={siteId}
              canUpload={canUpload}
              imagesOnly
              onSelect={(asset) => {
                setError(null);
                setCandidate(asset);
                void confirm(asset);
              }}
            />
          </Box>
        ) : null}
        {candidate ? (
          <Alert severity="info" sx={{ mt: 2 }} role="status">
            Selected candidate: {candidate.original_filename} ({candidate.id})
            {candidate.alt_text ? ` · Library alt: ${candidate.alt_text}` : " · No library alt text yet — add guidance on the field."}
          </Alert>
        ) : null}
        {error ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={cancel}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
