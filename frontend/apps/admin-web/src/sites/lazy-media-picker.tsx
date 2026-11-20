"use client";

import { lazy, Suspense, useId, type ComponentProps } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import type { MediaPickerDialog as MediaPickerDialogComponent } from "./media-picker";

type Props = ComponentProps<typeof MediaPickerDialogComponent>;

const MediaPickerDialog = lazy(async () => {
  const module = await import("./media-picker");
  return { default: module.MediaPickerDialog };
});

function LoadingPicker({ onCancel }: Pick<Props, "onCancel">) {
  const titleId = useId();
  return (
    <Dialog open onClose={onCancel} aria-labelledby={titleId} fullWidth maxWidth="md">
      <DialogTitle id={titleId}>Loading media library</DialogTitle>
      <DialogContent>
        <Box role="status" aria-label="Loading media library" sx={{ minHeight: 180, display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

export function LazyMediaPickerDialog(props: Props) {
  if (!props.open) return null;
  return (
    <Suspense fallback={<LoadingPicker onCancel={props.onCancel} />}>
      <MediaPickerDialog {...props} />
    </Suspense>
  );
}
