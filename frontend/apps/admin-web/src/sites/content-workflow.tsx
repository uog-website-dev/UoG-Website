"use client";

/**
 * Shared review controls for Pages and Posts.
 *
 * Buttons come only from the backend `available_actions` list. A reviewer
 * comment is required to reject and optional when approving. Scheduled
 * publishing is not offered: the workflow API accepts an action and a
 * comment, not a publish time.
 */
import Alert from "@mui/material/Alert";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export const WORKFLOW_ACTIONS = [
  "submit", "approve", "reject", "publish", "unpublish", "archive", "restore", "revise",
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** The workflow contract has no schedule field, so the control stays off. */
export const WORKFLOW_SCHEDULING_ENABLED = false;

const BUTTON_TEXT: Record<WorkflowAction, string> = {
  submit: "Submit",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  unpublish: "Unpublish",
  archive: "Archive",
  restore: "Restore",
  revise: "Return to draft",
};

export interface WorkflowTransition {
  id: number;
  from_status: string;
  to_status: string;
  actor: number | null;
  comment: string;
  created_at: string;
}

function actionLabel(action: WorkflowAction, title: string): string {
  if (action === "submit") return `Submit ${title} for review`;
  if (action === "revise") return `Return ${title} to draft`;
  return `${BUTTON_TEXT[action]} ${title}`;
}

export function ContentWorkflowButtons({
  title,
  available,
  disabled,
  onAction,
}: {
  title: string;
  available: readonly string[];
  disabled: boolean;
  onAction: (action: WorkflowAction) => void;
}) {
  const offered = new Set(available);
  return (
    <>
      {WORKFLOW_ACTIONS.filter((action) => offered.has(action)).map((action) => (
        <Button
          key={action}
          size="small"
          aria-label={actionLabel(action, title)}
          disabled={disabled}
          onClick={() => onAction(action)}
        >
          {BUTTON_TEXT[action]}
        </Button>
      ))}
    </>
  );
}

export function ContentWorkflowDialog({
  noun,
  action,
  title,
  comment,
  error,
  busy,
  onComment,
  onClose,
  onConfirm,
  children,
}: {
  noun: "Page" | "Post";
  action: WorkflowAction | null;
  title: string;
  comment: string;
  error: string;
  busy: boolean;
  onComment: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const heading = action === "revise" ? `Return ${noun} to draft?` : action
    ? `${action[0].toUpperCase()}${action.slice(1)} ${noun}?`
    : `Confirm ${noun} action`;
  const commentKind = action === "approve" || action === "reject";
  return (
    <Dialog
      open={action !== null}
      onClose={() => { if (!busy) onClose(); }}
      aria-labelledby={`${noun.toLowerCase()}-workflow-confirm-title`}
      fullWidth
      maxWidth={children ? "md" : "xs"}
    >
      <DialogTitle id={`${noun.toLowerCase()}-workflow-confirm-title`}>{heading}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        <Typography>
          {action ? `Confirm ${action} for “${title}”. The workflow status will change for this Site.` : ""}
        </Typography>
        {children}
        {commentKind ? (
          <TextField
            label={action === "reject" ? "Reviewer comment (required)" : "Reviewer comment (optional)"}
            value={comment}
            onChange={(event) => onComment(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            required={action === "reject"}
            inputProps={{ maxLength: 5000 }}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={busy || (action === "reject" && !comment.trim())}
        >
          Confirm {action === "revise" ? "return to draft" : action ?? "action"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ContentWorkflowHistory({
  title,
  open,
  loading,
  error,
  transitions,
  formatWhen,
  statusLabel,
  onClose,
}: {
  title: string;
  open: boolean;
  loading: boolean;
  error: string;
  transitions: readonly WorkflowTransition[];
  formatWhen: (value: string) => string;
  statusLabel: (status: string) => string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="content-workflow-history-title">
      <DialogTitle id="content-workflow-history-title">Workflow history: {title}</DialogTitle>
      <DialogContent dividers>
        {loading ? <Typography role="status">Loading workflow history…</Typography> : null}
        {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        {!loading && !error && transitions.length === 0 ? (
          <Typography color="text.secondary">No workflow transitions have been recorded.</Typography>
        ) : null}
        <Box component="ol" aria-label="Post status timeline" sx={{ m: 0, pl: 3 }}>
          {transitions.map((transition) => (
            <Box component="li" key={transition.id} sx={{ mb: 2 }}>
              <Typography fontWeight={600}>
                {statusLabel(transition.from_status)} → {statusLabel(transition.to_status)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatWhen(transition.created_at)} · {transition.actor == null ? "Former user" : `User ${transition.actor}`}
              </Typography>
              {transition.comment ? <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>{transition.comment}</Typography> : null}
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
