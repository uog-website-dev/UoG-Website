"use client";

/**
 * Create / edit an organization unit.
 *
 * One component serves both modes so the two screens cannot drift. The form
 * gives immediate feedback for rules it can check locally (required fields,
 * code shape, JSON metadata) but never claims a write is acceptable — the
 * Django serializer and the database lifecycle function are the sole
 * authorities, and their answers are rendered verbatim:
 *
 *   - 400 field errors   -> attached to the offending field, plus a summary
 *   - 409 conflict       -> duplicate code / cycle / lifecycle clash
 *   - 412 / 428          -> concurrent edit; ask the user to reload
 *   - 403 permission     -> writes are not enabled in this environment
 *
 * The access token never reaches this component: submit calls a server action
 * that reads it from the Auth.js session server-side.
 */
import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import {
  FormErrorSummary,
  FormField,
  SelectFilter,
  fieldErrorsFrom,
  useToast,
} from "@uog/ui";
import type { Organization } from "@uog/types";

import {
  createOrganization,
  getOrganizationTree,
  updateOrganization,
} from "@/app/organizations/actions";
import {
  deserializeApiError,
  type ActionResult,
  type ApiErrorPayload,
} from "@/organizations/contract";
import {
  ORGANIZATION_TYPE_OPTIONS,
  emptyOrganizationForm,
  formValuesFromOrganization,
  normalizeCode,
  parentOptionsFor,
  tryParseMetadata,
  validateOrganizationForm,
  type OrganizationFormValues,
} from "@/organizations/validation";

interface OrganizationFormProps {
  /** Existing unit being edited, or null to create. */
  organization: Organization | null;
  /** Strong ETag from the detail read; required for conditional update. */
  etag: string | null;
}

/** Human text for a non-field failure, covering the lifecycle/conflict cases. */
function describeFailure(payload: ApiErrorPayload): string {
  switch (payload.status) {
    case 403:
      return "Writing organizations is not enabled in this environment. The platform requires development-mode writes to be switched on before these changes are accepted.";
    case 409:
      return "This change conflicts with the current organization state — the code may already exist, or the hierarchy/lifecycle rules forbid it. Reload to see the latest data, then adjust your change.";
    case 412:
      return "This organization changed since you opened it. Reload to get the current version, then reapply your edit.";
    case 428:
      return "The update is missing its concurrency token. Reload the organization and try again.";
    case 401:
      return "Your session has expired. Sign in again to continue.";
    case 0:
      return "The API could not be reached. Check that the backend is running, then try again.";
    default:
      return payload.message;
  }
}

export function OrganizationForm({
  organization,
  etag,
}: OrganizationFormProps) {
  const router = useRouter();
  const toast = useToast();
  const mode: "create" | "edit" = organization ? "edit" : "create";

  const [values, setValues] = useState<OrganizationFormValues>(() =>
    organization ? formValuesFromOrganization(organization) : emptyOrganizationForm(),
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Parent candidates come from the flat hierarchy endpoint. Loaded once per
  // mount; the select stays usable (empty) if it fails, because the backend
  // validates the parent id authoritatively on submit anyway.
  const [parentOptions, setParentOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [treeFailed, setTreeFailed] = useState(false);

  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Backend rules: the institutional root cannot be moved or retyped, and
  // archived units are frozen. Editing name/description/metadata stays
  // allowed, but the hierarchy controls are locked rather than offered and
  // rejected — the lifecycle function raises a 400 we would only bounce back.
  const hierarchyLocked =
    mode === "edit" &&
    (organization!.parent === null || organization!.status === "ARCHIVED");
  const hierarchyLockReason =
    organization?.parent === null
      ? "The institutional root cannot be moved or retyped."
      : "Archived units cannot be moved or retyped.";

  useEffect(() => {
    let cancelled = false;
    getOrganizationTree().then((result: ActionResult<{ results: Organization[] }>) => {
      if (cancelled) return;
      if (result.ok) {
        setParentOptions(parentOptionsFor(result.data.results, organization));
      } else {
        setTreeFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  // Move focus to the error summary after a failed submit so keyboard and
  // screen-reader users land on the problem instead of hunting for it.
  useEffect(() => {
    if (failure || Object.keys(serverErrors).length > 0) {
      summaryRef.current?.focus();
    }
  }, [failure, serverErrors]);

  const setField = (field: keyof OrganizationFormValues) => (value: string) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  const fieldIds: Record<string, string> = {
    code: "org-code",
    name: "org-name",
    short_name: "org-short-name",
    organization_type: "org-type",
    parent: "org-parent",
    description: "org-description",
    metadata: "org-metadata",
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // 1. Local checks give instant feedback; the server still re-validates.
    const local = validateOrganizationForm(values, { mode });
    setClientErrors(local);
    setServerErrors({});
    setFailure(null);
    if (Object.keys(local).length > 0) return;

    // 2. Build the approved DTO payload. `status`, `id` and timestamps are
    //    read-only on the backend and are never sent; `code` is immutable
    //    after creation, so edits omit it entirely.
    const metadata = tryParseMetadata(values.metadata);
    if (metadata.error) {
      setClientErrors({ metadata: metadata.error });
      return;
    }

    const base = {
      name: values.name.trim(),
      short_name: values.short_name.trim(),
      organization_type: values.organization_type,
      parent: values.parent === "" ? null : Number(values.parent),
      description: values.description.trim(),
      metadata: metadata.value ?? {},
    };

    setPending(true);
    try {
      const result =
        mode === "create"
          ? await createOrganization({ ...base, code: normalizeCode(values.code) })
          : await updateOrganization(organization!.id, etag ?? "", base);

      if (!result.ok) {
        const payload = result.error;
        const fields = fieldErrorsFrom(deserializeApiError(payload));
        // Duplicate code arrives as a 409 carrying a `code` field error.
        if (payload.status === 409 && payload.details && typeof payload.details === "object") {
          const details = payload.details as Record<string, unknown>;
          for (const [field, value] of Object.entries(details)) {
            if (Array.isArray(value) && value.length > 0) {
              fields[field] = value.map(String).join(" ");
            }
          }
        }
        if (Object.keys(fields).length > 0) {
          setServerErrors(fields);
        } else {
          setFailure(describeFailure(payload));
        }
        return;
      }

      // 3. Success: announce it, then refresh the destination view.
      toast.success(
        mode === "create"
          ? `Created ${result.data.data.name}.`
          : `Saved ${result.data.data.name}.`,
      );
      router.push("/organizations");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const allErrors: Record<string, string> = { ...clientErrors, ...serverErrors };
  const showCode = mode === "create";

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={handleSubmit}
      // Validation is ours, not the browser's: native bubbles are not
      // announced reliably, stop at the first invalid field and never show
      // the error summary below. `required` stays on the inputs so assistive
      // technology still announces the fields as required.
      noValidate
      sx={{ p: { xs: 2.5, sm: 3.5 }, display: "flex", flexDirection: "column", gap: 2.5 }}
    >
      <Box
        ref={summaryRef}
        tabIndex={-1}
        sx={{ display: "flex", flexDirection: "column", gap: 2, outline: "none" }}
      >
        <FormErrorSummary errors={allErrors} fieldIds={fieldIds} />

        {failure ? (
          <Alert severity="error" role="alert">
            {failure}
          </Alert>
        ) : null}

        {treeFailed ? (
          <Alert severity="warning">
            The parent list could not be loaded. You can still save with an
            explicit parent, but the selector may be incomplete.
          </Alert>
        ) : null}
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        {showCode ? (
          <FormField
            label="Code"
            name="code"
            value={values.code}
            onChange={setField("code")}
            error={allErrors.code}
            hint="Uppercase letters, digits, _ or -. Immutable once created."
            required
            placeholder="INFORMATICS"
          />
        ) : (
          <TextField
            id="org-code"
            label="Code"
            value={values.code}
            size="small"
            fullWidth
            disabled
            helperText="Codes cannot be changed after creation."
            inputProps={{ readOnly: true, "aria-readonly": true }}
          />
        )}

        <Box>
          <SelectFilter
            id="org-type"
            label="Organization type"
            value={values.organization_type}
            options={[...ORGANIZATION_TYPE_OPTIONS]}
            onChange={setField("organization_type")}
            includeAll={false}
            disabled={hierarchyLocked}
          />
          <Typography
            variant="caption"
            color={hierarchyLocked ? "text.secondary" : "error"}
            role={allErrors.organization_type ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.organization_type ??
              (hierarchyLocked ? hierarchyLockReason : "Server validates this choice.")}
          </Typography>
        </Box>
      </Box>

      <FormField
        label="Name"
        name="name"
        value={values.name}
        onChange={setField("name")}
        error={allErrors.name}
        hint="Full display name, e.g. College of Informatics."
        required
      />

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        <FormField
          label="Short name"
          name="short_name"
          value={values.short_name}
          onChange={setField("short_name")}
          error={allErrors.short_name}
          hint="Optional abbreviation shown in tight layouts."
        />

        <Box>
          <SelectFilter
            id="org-parent"
            label="Parent unit"
            value={values.parent}
            options={parentOptions}
            onChange={setField("parent")}
            includeAll
            allLabel="None (institutional root)"
            disabled={hierarchyLocked}
          />
          <Typography
            variant="caption"
            color={hierarchyLocked ? "text.secondary" : "error"}
            role={allErrors.parent ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.parent ??
              (hierarchyLocked
                ? hierarchyLockReason
                : "Self and descendant units are excluded; the server checks for cycles.")}
          </Typography>
        </Box>
      </Box>

      <FormField
        label="Description"
        name="description"
        value={values.description}
        onChange={setField("description")}
        error={allErrors.description}
        hint="Optional summary of the unit's purpose."
        multiline
        rows={3}
      />

      <FormField
        label="Metadata (JSON)"
        name="metadata"
        value={values.metadata}
        onChange={setField("metadata")}
        error={allErrors.metadata}
        hint='Optional JSON object, e.g. {"established": 1954}. Leave blank for none.'
        multiline
        rows={4}
      />

      <Box sx={{ display: "flex", gap: 1.5, justifyContent: "flex-end", pt: 0.5 }}>
        <Button
          type="button"
          variant="outlined"
          color="inherit"
          disabled={pending}
          onClick={() => router.push("/organizations")}
        >
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
              Saving…
            </>
          ) : mode === "create" ? (
            "Create organization"
          ) : (
            "Save changes"
          )}
        </Button>
      </Box>
    </Paper>
  );
}
