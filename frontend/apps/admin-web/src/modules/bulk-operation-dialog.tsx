"use client";

/**
 * Preview, confirm and result for one bulk module operation.
 *
 * The preview is computed by the backend and writes nothing. Confirming
 * sends the signed preview token with an Idempotency-Key that is fixed for
 * that preview, so retrying after a lost response cannot apply twice.
 * Success is shown only after the backend reports the committed operation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import { applyModuleOperation, previewModuleOperation } from "@/app/modules/actions";
import {
  ACTION_LABELS,
  OUTCOME_LABELS,
  STATE_LABELS,
  newIdempotencyKey,
  rejectionMessage,
  rejectionReason,
} from "@/modules/bulk-contract";
import type { ApplyRequest, ApplyResult, ModuleAction, OperationPreview, OperationScope, SiteOutcome } from "@/modules/bulk-contract";
import type { ApiErrorPayload } from "@/organizations/contract";

type Phase =
  | { kind: "previewing" }
  | { kind: "preview"; preview: OperationPreview }
  | { kind: "preview-error"; error: ApiErrorPayload }
  | { kind: "applying"; preview: OperationPreview }
  | { kind: "apply-error"; preview: OperationPreview; error: ApiErrorPayload }
  | { kind: "applied"; preview: OperationPreview; result: ApplyResult };

function sites(count: number): string {
  return `${count} ${count === 1 ? "Site" : "Sites"}`;
}

const OUTCOME_COLOR: Record<SiteOutcome, "success" | "default" | "error" | "warning"> = {
  CHANGE: "success",
  UNCHANGED: "default",
  BLOCKED: "error",
  PARTIAL: "warning",
};

/** What the operator should understand and do after a failed apply. */
export function describeApplyError(error: ApiErrorPayload): { title: string; message: string; retry: "same" | "refresh" | "none" } {
  const reason = rejectionReason(error.details);
  const detail = rejectionMessage(error.details);
  if (error.status === 409 && (reason === "stale_preview" || reason === "preview_expired")) {
    return {
      title: reason === "stale_preview" ? "The preview is out of date" : "The preview expired",
      message: `${detail ?? "Sites or modules changed after the preview."} Nothing was changed. Refresh the preview and review it again.`,
      retry: "refresh",
    };
  }
  if (error.status === 409) {
    return { title: "This request conflicts with another one", message: `${detail ?? error.message} Nothing was changed.`, retry: "refresh" };
  }
  if (error.status === 403) {
    return {
      title: "Not allowed",
      message: `${detail ?? "You do not have permission to change modules centrally."} Nothing was changed.`,
      retry: "none",
    };
  }
  if (error.status === 401) {
    return { title: "Sign-in required", message: "Your session has ended. Nothing was changed. Sign in again and repeat the preview.", retry: "none" };
  }
  if (error.status === 400) {
    return { title: "The request was rejected", message: `${detail ?? error.message} Nothing was changed.`, retry: "none" };
  }
  if (error.status === 0 || error.status >= 500) {
    return {
      title: "The result is not confirmed",
      message:
        "The server did not confirm the operation. Retrying is safe: the same request key is sent, so the change cannot be applied twice.",
      retry: "same",
    };
  }
  return { title: "The operation failed", message: `${detail ?? error.message} Nothing was changed.`, retry: "none" };
}

export function BulkOperationDialog({
  action,
  modules,
  scope,
  scopeLabel,
  onClose,
  onApplied,
  onShowHistory,
}: {
  action: ModuleAction;
  modules: string[];
  scope: OperationScope;
  scopeLabel: string;
  onClose: () => void;
  onApplied: (result: ApplyResult) => void;
  onShowHistory: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [phase, setPhase] = useState<Phase>({ kind: "previewing" });
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [attempt, setAttempt] = useState(0);
  const submitted = useRef<ApplyRequest | null>(null);
  const previewGeneration = useRef(0);
  const verb = ACTION_LABELS[action].verb;

  const runPreview = useCallback(async () => {
    const generation = ++previewGeneration.current;
    submitted.current = null;
    setPhase({ kind: "previewing" });
    setConfirmation("");
    const result = await previewModuleOperation({ action, modules, scope });
    if (generation !== previewGeneration.current) return;
    setPhase(result.ok ? { kind: "preview", preview: result.data } : { kind: "preview-error", error: result.error });
  }, [action, modules, scope]);

  useEffect(() => {
    void runPreview();
    return () => { previewGeneration.current++; };
  }, [runPreview, attempt]);

  const preview = phase.kind === "previewing" || phase.kind === "preview-error" ? null : phase.preview;
  const idempotencyKey = useMemo(() => (preview ? newIdempotencyKey() : ""), [preview?.preview_token]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasonMissing = Boolean(preview?.high_impact) && reason.trim() === "";
  const phraseMissing = Boolean(preview?.high_impact) && confirmation.trim().toUpperCase() !== preview?.confirmation_phrase;
  const nothingToDo = preview !== null && preview.summary.expected_changes === 0;
  const busy = phase.kind === "previewing" || phase.kind === "applying";

  const apply = async () => {
    if (!preview || reasonMissing || phraseMissing || nothingToDo) return;
    setPhase({ kind: "applying", preview });
    submitted.current ??= {
      previewToken: preview.preview_token,
      idempotencyKey,
      reason: reason.trim(),
      confirmation: confirmation.trim().toUpperCase(),
    };
    const result = await applyModuleOperation(submitted.current);
    if (result.ok) {
      setPhase({ kind: "applied", preview, result: result.data });
      onApplied(result.data);
    } else {
      if (describeApplyError(result.error).retry !== "same") submitted.current = null;
      setPhase({ kind: "apply-error", preview, error: result.error });
    }
  };

  const failure = phase.kind === "apply-error" ? describeApplyError(phase.error) : null;
  const cannotRetry =
    phase.kind === "apply-error" && (failure?.retry === "refresh" || phase.error.status === 401 || phase.error.status === 403);
  const retryUncertain = phase.kind === "apply-error" && failure?.retry === "same";

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={fullScreen}
      aria-labelledby="bulk-dialog-title"
      aria-describedby="bulk-dialog-scope"
    >
      <DialogTitle id="bulk-dialog-title">
        {phase.kind === "applied" ? `${ACTION_LABELS[action].past} ${modules.join(", ")}` : `${verb} ${modules.join(", ")}`}
      </DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography id="bulk-dialog-scope" variant="body2" color="text.secondary">
          Scope: {scopeLabel}
        </Typography>

        {phase.kind === "previewing" ? (
          <Box role="status" aria-live="polite" sx={{ display: "flex", alignItems: "center", gap: 2, py: 4, justifyContent: "center" }}>
            <CircularProgress size={28} />
            <Typography>Checking eligibility for every Site…</Typography>
          </Box>
        ) : null}

        {phase.kind === "preview-error" ? (
          <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>The preview could not be prepared.</Typography>
            <Typography variant="body2">
              {rejectionMessage(phase.error.details) ?? phase.error.message}
              {phase.error.requestId ? ` Reference: ${phase.error.requestId}.` : ""}
            </Typography>
          </Alert>
        ) : null}

        {phase.kind === "applied" ? (
          <Alert severity="success" role="status">
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {phase.result.replayed ? "This operation was already committed." : "The operation was committed."}
            </Typography>
            <Typography variant="body2">
              {phase.result.operation.change_count} Site-module {phase.result.operation.change_count === 1 ? "change" : "changes"} on {sites(phase.result.operation.changed_site_count)}.
              {" "}Already in that state: {phase.result.operation.unchanged_count}. Blocked: {phase.result.operation.blocked_count}.
              {" "}Operation {phase.result.operation.id}.
            </Typography>
          </Alert>
        ) : null}

        {failure ? (
          <Alert severity={failure.retry === "same" ? "warning" : "error"} role="alert">
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{failure.title}</Typography>
            <Typography variant="body2">
              {failure.message}
              {phase.kind === "apply-error" && phase.error.requestId ? ` Reference: ${phase.error.requestId}.` : ""}
            </Typography>
          </Alert>
        ) : null}

        {preview && phase.kind !== "applied" ? (
          <>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
              {[
                ["Matching Sites", preview.summary.matched_sites],
                ["Will change", preview.summary.eligible_sites],
                ["Already in state", preview.summary.already_in_state_sites],
                ["Blocked", preview.summary.blocked_sites],
              ].map(([label, value]) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>{value}</Typography>
                </Paper>
              ))}
            </Box>
            <Typography variant="body2">
              <strong>{preview.summary.expected_changes}</strong> Site-module {preview.summary.expected_changes === 1 ? "change" : "changes"} will be made.
              {action === "DISABLE" ? " Content stays; authoring and public delivery for these modules stop until they are enabled again." : ""}
            </Typography>

            {preview.summary.blocked_reasons.length > 0 ? (
              <Alert severity="warning">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Blocked Site-module pairs are skipped</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {preview.summary.blocked_reasons.map((item) => (
                    <li key={item.code}>
                      <Typography variant="body2">{item.message} ({item.count})</Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            ) : null}
            {preview.dependency_warnings.length > 0 ? (
              <Alert severity="info">
                {preview.dependency_warnings.map((warning) => (
                  <Typography key={warning.module} variant="body2">{warning.message}</Typography>
                ))}
              </Alert>
            ) : null}
            {nothingToDo ? (
              <Alert severity="info">Nothing would change, so there is nothing to confirm.</Alert>
            ) : null}

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
              <Table size="small" stickyHeader aria-label="Expected result per Site">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Site</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Result</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Modules</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.sites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{site.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{site.organization.name} · {site.status.toLowerCase()}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={OUTCOME_COLOR[site.outcome]} variant="outlined" label={OUTCOME_LABELS[site.outcome]} />
                      </TableCell>
                      <TableCell>
                        {site.modules.map((pair) => (
                          <Typography key={pair.code} variant="body2">
                            <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{pair.code}</Box>
                            {": "}
                            {pair.outcome === "CHANGE"
                              ? `${STATE_LABELS[pair.previous_state]} → ${STATE_LABELS[pair.new_state]}`
                              : pair.outcome === "UNCHANGED"
                                ? `Already ${STATE_LABELS[pair.previous_state].toLowerCase()}`
                                : pair.reasons.map((item) => (item.module ? `${item.message} (${item.module})` : item.message)).join(" ")}
                          </Typography>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {!nothingToDo ? (
              <>
                <TextField
                  label={preview.high_impact ? "Reason (required)" : "Reason (optional)"}
                  value={reason}
                  onChange={(event) => setReason(event.target.value.slice(0, 500))}
                  multiline
                  minRows={2}
                  disabled={busy || retryUncertain}
                  required={preview.high_impact}
                  error={phase.kind === "apply-error" && reasonMissing}
                  helperText={`Recorded in the audit trail and operation history. ${reason.length}/500`}
                />
                {preview.high_impact ? (
                  <Alert severity="warning">
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>High-impact operation</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      This changes {sites(preview.summary.eligible_sites)}. Type <strong>{preview.confirmation_phrase}</strong> to confirm.
                    </Typography>
                    <TextField
                      size="small"
                      label={`Type ${preview.confirmation_phrase}`}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      disabled={busy || retryUncertain}
                      autoComplete="off"
                    />
                  </Alert>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {phase.kind === "applied" ? (
          <>
            <Button onClick={onShowHistory}>View history</Button>
            <Button variant="contained" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            {failure?.retry === "refresh" ? (
              <Button variant="outlined" onClick={() => setAttempt((n) => n + 1)}>Refresh preview</Button>
            ) : null}
            {preview ? (
              <Button
                variant="contained"
                color={action === "DISABLE" ? "warning" : "primary"}
                onClick={apply}
                disabled={busy || nothingToDo || reasonMissing || phraseMissing || cannotRetry}
                startIcon={phase.kind === "applying" ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {phase.kind === "applying"
                  ? "Applying…"
                  : failure?.retry === "same"
                    ? "Retry"
                    : `${verb} on ${sites(preview.summary.eligible_sites)}`}
              </Button>
            ) : null}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
