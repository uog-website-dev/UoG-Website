"use client";

/**
 * Grant a role to a user within one scope (platform-wide, a Site or an
 * Organization).
 *
 * The dialog offers only what `CallerAccess` reports — the roles this
 * administrator may grant and the scopes they manage — as a *usability*
 * boundary. It is not a security boundary: every submission still travels to
 * the backend, which re-checks the caller's own authority and answers 403
 * when the grant exceeds it (the console renders that answer verbatim, and
 * never claims a grant was acceptable on the server's behalf).
 *
 * Failure behaviour: the dialog stays open with the entered values intact
 * and maps backend field errors onto the offending control, so a rejected
 * submission never costs the administrator their work. A pending request
 * disables the submit button, so double submissions cannot race.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import type {
  AssignmentScopeType,
  CallerAccess,
  PlatformRole,
  PlatformUser,
} from "@uog/types";

import { ROLE_CATALOG } from "@uog/api-client";
import { SelectFilter, useToast } from "@uog/ui";

import { createAssignment } from "@/app/access/actions";
import { deserializeApiError, isOk } from "@/organizations/contract";

const SCOPE_TYPE_LABELS: Record<AssignmentScopeType, string> = {
  PLATFORM: "Platform-wide",
  SITE: "Site",
  ORGANIZATION: "Organization",
};

export interface AssignDialogProps {
  open: boolean;
  /** The user the grant will apply to; always shown in the dialog. */
  user: PlatformUser;
  /** The signed-in administrator's server-computed authority. */
  caller: CallerAccess;
  onClose: () => void;
  /** Called after a successful grant so the screen can refresh. */
  onSaved: () => void;
}

export function AssignDialog({
  open,
  user,
  caller,
  onClose,
  onSaved,
}: AssignDialogProps) {
  const toast = useToast();
  const [role, setRole] = useState("");
  const [scopeType, setScopeType] = useState<AssignmentScopeType | "">("");
  const [scopeId, setScopeId] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const roleOptions = ROLE_CATALOG.filter((entry) =>
    caller.assignable_roles.includes(entry.code),
  ).map((entry) => ({ value: entry.code, label: entry.label }));

  const scopeTypes = Array.from(
    new Set(caller.manageable_scopes.map((scope) => scope.type)),
  );
  const scopeTypeOptions = scopeTypes.map((type) => ({
    value: type,
    label: SCOPE_TYPE_LABELS[type],
  }));
  const scopesForType = caller.manageable_scopes.filter(
    (scope) => scope.type === scopeType,
  );
  const scopeOptions = scopesForType.map((scope) => ({
    value: String(scope.id ?? ""),
    label: scope.label,
  }));

  // Reset the form each time the dialog opens, so a previous attempt never
  // leaks into a new one.
  useEffect(() => {
    if (!open) return;
    setRole("");
    setScopeType(scopeTypes[0] ?? "");
    setScopeId("");
    setPending(false);
    setErrorMessage(null);
    setFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedScope = scopesForType.find(
    (scope) => String(scope.id ?? "") === scopeId,
  );
  const roleLabel = roleOptions.find((option) => option.value === role)?.label;

  const validate = (): string | null => {
    if (!role) return "Select the role to grant.";
    if (!scopeType) return "Select where the role applies.";
    if (scopeType !== "PLATFORM" && !scopeId) {
      return "Select the scope the role applies to.";
    }
    return null;
  };

  const submit = async () => {
    if (pending) return; // never allow a second in-flight submission
    const problem = validate();
    if (problem) {
      setErrorMessage(problem);
      return;
    }

    setPending(true);
    setErrorMessage(null);
    setFieldErrors({});

    const result = await createAssignment({
      user_id: user.id,
      role: role as PlatformRole,
      scope_type: scopeType as AssignmentScopeType,
      scope_id: scopeType === "PLATFORM" ? null : Number(scopeId),
    });
    setPending(false);

    if (isOk(result)) {
      toast.success(`Role assigned to ${user.username}.`);
      onSaved();
      onClose();
      return;
    }

    // Keep the dialog (and everything typed into it) intact, and map the
    // backend's own field errors onto the controls.
    const error = deserializeApiError(result.error);
    setErrorMessage(error.message);
    setFieldErrors(error.fieldErrors ?? {});
  };

  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      aria-labelledby="assign-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="assign-dialog-title" sx={{ fontWeight: 700 }}>
        Assign a role
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: "12px !important" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            p: 1.5,
            borderRadius: 2,
            bgcolor: "action.hover",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {user.username}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user.first_name} {user.last_name} · {user.email}
          </Typography>
        </Box>

        <SelectFilter
          id="assign-role"
          label="Role"
          value={role}
          options={roleOptions}
          onChange={setRole}
          includeAll={false}
        />
        {fieldErrors.role ? (
          <Typography
            id="assign-role-error"
            variant="caption"
            color="error"
            role="alert"
          >
            {fieldErrors.role.join(" ")}
          </Typography>
        ) : null}

        <SelectFilter
          id="assign-scope-type"
          label="Scope type"
          value={scopeType}
          options={scopeTypeOptions}
          onChange={(value) => {
            setScopeType(value as AssignmentScopeType | "");
            setScopeId("");
          }}
          includeAll={false}
        />

        {scopeType && scopeType !== "PLATFORM" ? (
          <SelectFilter
            id="assign-scope"
            label={scopeType === "SITE" ? "Site" : "Organization"}
            value={scopeId}
            options={scopeOptions}
            onChange={setScopeId}
            includeAll={false}
          />
        ) : scopeType === "PLATFORM" ? (
          <Chip label="Whole platform" color="primary" variant="outlined" />
        ) : null}
        {fieldErrors.scope_id ? (
          <Typography
            id="assign-scope-error"
            variant="caption"
            color="error"
            role="alert"
          >
            {fieldErrors.scope_id.join(" ")}
          </Typography>
        ) : null}

        {role && scopeType && (scopeType === "PLATFORM" || selectedScope) ? (
          <Alert severity="info" sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2">
              <strong>{user.username}</strong> will hold{" "}
              <strong>{roleLabel}</strong> in{" "}
              <strong>
                {scopeType === "PLATFORM"
                  ? "Whole platform"
                  : selectedScope?.label}
              </strong>
              .
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              The backend validates this grant authoritatively and may still
              refuse it; this form only previews the request.
            </Typography>
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert severity="error" role="alert">
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={pending || roleOptions.length === 0}
          variant="contained"
        >
          {pending ? "Assigning…" : "Assign role"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
