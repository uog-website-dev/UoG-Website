"use client";

/**
 * Shared confirmation dialog for destructive or irreversible admin actions.
 *
 * Lifecycle changes (deactivating or archiving an organization) require an
 * explicit confirmation because the backend treats them as domain
 * transitions guarded by ETags and descendant rules. This dialog makes the
 * consequence explicit and is fully keyboard operable:
 *
 *   - it is a real MUI Dialog, so focus is trapped while open, Escape
 *     closes it, and focus returns to the trigger on close;
 *   - the title and description are wired via `aria-labelledby` /
 *     `aria-describedby`, so screen readers announce the question;
 *   - the confirm button can carry a busy state while the request is in
 *     flight, and a failure is rendered inline (never swallowed).
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useId } from "react";

import { ApiError } from "@uog/api-client";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in plain language. */
  description: React.ReactNode;
  /** Extra context, e.g. the code of the organization being changed. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colour of the confirm button; use "error" for destructive actions. */
  confirmColor?: "primary" | "error";
  /** True while the confirming request is in flight. */
  pending?: boolean;
  /** When set, rendered as an inline alert inside the dialog. */
  error?: ApiError | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmColor = "primary",
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onCancel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId} sx={{ fontWeight: 700 }}>
        {title}
      </DialogTitle>

      <DialogContent>
        <Box id={descriptionId} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
          {children}
        </Box>

        {error ? (
          <Alert severity="error" sx={{ mt: 2 }} role="alert">
            {error.message}
            {error.requestId ? (
              <Typography
                variant="caption"
                display="block"
                sx={{ fontFamily: "monospace", mt: 0.5 }}
              >
                Reference: {error.requestId}
              </Typography>
            ) : null}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={pending} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={pending}
          variant="contained"
          color={confirmColor}
        >
          {pending ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
