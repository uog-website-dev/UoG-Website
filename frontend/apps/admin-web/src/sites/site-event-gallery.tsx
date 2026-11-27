"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createEventGalleryImages,
  detachEventGalleryImage,
  listEventGallery,
  publishEventGalleryImage,
  reorderEventGallery,
  updateEventGalleryImage,
  type EventGalleryImageRow,
} from "@/app/sites/event-gallery-actions";
import { LazyMediaPickerDialog as MediaPickerDialog } from "@/sites/lazy-media-picker";
import type { MediaPickerResult } from "@/sites/media-picker-model";

export function SiteEventGallery({
  siteId,
  eventId,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<EventGalleryImageRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await listEventGallery(siteId, eventId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Gallery could not be loaded.");
      setRows([]);
      return;
    }
    setRows(result.data);
  }, [siteId, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onConfirmMany(results: MediaPickerResult[]) {
    if (!consent) {
      setError("Confirm media usage and consent policy before attaching images.");
      return;
    }
    setBusy(true);
    const result = await createEventGalleryImages(
      siteId,
      eventId,
      results.map((item) => ({
        media_asset: item.assetId,
        alt_text: item.altText || item.originalFilename || "Event photo",
        usage_consent: true,
        is_published: false,
      })),
    );
    setBusy(false);
    setPickerOpen(false);
    if (!result.ok) {
      setError(result.error.message || "Images could not be attached.");
      return;
    }
    await load();
  }

  async function onSaveMeta(row: EventGalleryImageRow, patch: { caption?: string; alt_text?: string }) {
    setBusy(true);
    const result = await updateEventGalleryImage(siteId, eventId, row.id, {
      ...patch,
      version: row.version,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Gallery image could not be updated.");
      return;
    }
    await load();
  }

  async function onPublish(row: EventGalleryImageRow, isPublished: boolean) {
    setBusy(true);
    const result = await publishEventGalleryImage(siteId, eventId, row.id, isPublished, row.version);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Visibility could not be updated.");
      return;
    }
    await load();
  }

  async function onDetach(row: EventGalleryImageRow) {
    setBusy(true);
    const result = await detachEventGalleryImage(siteId, eventId, row.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Image could not be detached.");
      return;
    }
    await load();
  }

  async function onMove(row: EventGalleryImageRow, direction: -1 | 1) {
    const index = rows.findIndex((item) => item.id === row.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const order = next.map((item) => item.id);
    const versions = Object.fromEntries(rows.map((item) => [item.id, item.version]));
    setBusy(true);
    const result = await reorderEventGallery(siteId, eventId, order, versions);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Order could not be updated.");
      return;
    }
    setRows(result.data);
  }

  return (
    <Box component="section" aria-labelledby="event-gallery" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-gallery" variant="h6" component="h2">
        Gallery
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Add Site Media Library images without duplicating files. Publish photos independently before, during, or after the Event.
        Detaching keeps the canonical media asset. Quarantined or pending scans cannot be published.
      </Typography>

      {!readOnly ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <FormControlLabel
            control={<Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)} />}
            label="I confirm usage/consent policy for these Event photos"
          />
          <Button
            ref={addButtonRef}
            variant="contained"
            disabled={busy || !consent}
            onClick={() => setPickerOpen(true)}
          >
            Add images
          </Button>
        </Box>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {busy && rows.length === 0 ? <Typography role="status">Loading gallery…</Typography> : null}
      {rows.length === 0 ? (
        <Typography color="text.secondary">No gallery images attached yet.</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((row, index) => (
            <Box
              component="li"
              key={row.id}
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", sm: "120px 1fr" },
                borderBottom: "1px solid",
                borderColor: "divider",
                pb: 1.5,
              }}
            >
              <Box
                component="img"
                src={row.thumbnail_url}
                alt=""
                sx={{ width: 120, height: 90, objectFit: "cover", borderRadius: 1 }}
              />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {row.original_filename || "Image"} · {row.is_published ? "Published" : "Draft"}
                  {row.asset_ready === false ? " · not ready" : ""}
                </Typography>
                <TextField
                  size="small"
                  label="Caption"
                  defaultValue={row.caption}
                  disabled={busy || readOnly}
                  onBlur={(event) => {
                    if (event.target.value !== row.caption) {
                      void onSaveMeta(row, { caption: event.target.value });
                    }
                  }}
                />
                <TextField
                  size="small"
                  label="Alt text"
                  defaultValue={row.alt_text}
                  disabled={busy || readOnly}
                  required
                  onBlur={(event) => {
                    if (event.target.value !== row.alt_text) {
                      void onSaveMeta(row, { alt_text: event.target.value });
                    }
                  }}
                />
                {!readOnly ? (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    <Button size="small" disabled={busy || index === 0} onClick={() => void onMove(row, -1)}>
                      Move up
                    </Button>
                    <Button size="small" disabled={busy || index === rows.length - 1} onClick={() => void onMove(row, 1)}>
                      Move down
                    </Button>
                    {row.is_published ? (
                      <Button size="small" disabled={busy} onClick={() => void onPublish(row, false)}>
                        Unpublish
                      </Button>
                    ) : (
                      <Button size="small" variant="contained" disabled={busy} onClick={() => void onPublish(row, true)}>
                        Publish
                      </Button>
                    )}
                    <Button size="small" color="warning" disabled={busy} onClick={() => void onDetach(row)}>
                      Detach
                    </Button>
                  </Box>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <MediaPickerDialog
        open={pickerOpen}
        siteId={siteId}
        multiple
        canUpload
        returnFocusRef={addButtonRef}
        title="Choose Event gallery images"
        onCancel={() => setPickerOpen(false)}
        onConfirm={() => undefined}
        onConfirmMany={(results) => void onConfirmMany(results)}
      />
    </Box>
  );
}
