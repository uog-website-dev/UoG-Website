"use client";

/**
 * Add / edit one domain record.
 *
 * One dialog serves both modes so the two cannot drift. It collects:
 *
 *   - Associated Site        (immutable on edit — a domain cannot change Site)
 *   - Hostname               (immutable on edit — backend rule)
 *   - Type: Primary or Alias (Alias → Primary via make-primary; a Primary
 *     cannot be demoted because no API clears the designation — the control
 *     says so instead of silently failing)
 *   - Status: Active/Inactive (activate/deactivate actions)
 *
 * The selected Site's current primary domain is shown while editing, and
 * any operation that would *change* which domain is primary (making a
 * different domain primary) is confirmed first, naming the domain that
 * loses the designation.
 *
 * Hostnames are normalized with the same rules as the backend
 * (`normalizeHostname` mirrors apps/sites/hostnames.py) before submit, and
 * the backend re-validates: its 400 field errors land on the offending
 * field, a duplicate surfaces as the API's 409 under `hostname`, and any
 * other failure is shown verbatim with the request id. Values entered by
 * the operator are never cleared on a failed submit, and `pending` blocks
 * double submission while a request is in flight.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  ConfirmDialog,
  FormErrorSummary,
  SelectFilter,
  fieldErrorsFrom,
  useToast,
} from "@uog/ui";
import { normalizeHostname } from "@uog/api-client";
import type { DomainRecord, Site, SiteDomainStatus } from "@uog/types";

import {
  createSiteDomain,
  listSiteDomains,
  makeSiteDomainPrimary,
  updateSiteDomain,
} from "@/app/sites/actions";
import { deserializeApiError } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";

export interface DomainFormDialogProps {
  open: boolean;
  /** Existing record to edit, or null to add. */
  record: DomainRecord | null;
  /** Sites offered in the selector (must include the record's site). */
  sites: Site[];
  onClose: () => void;
  /** Called after any successful mutation so the caller can reload. */
  onSaved: () => void;
}

interface FormValues {
  site: string;
  hostname: string;
  type: "primary" | "alias";
  status: SiteDomainStatus;
}

/** Human text for a non-field failure, covering permission/conflict cases. */
function describeFailure(payload: ApiErrorPayload): string {
  switch (payload.status) {
    case 403:
      return "Writing domains is not enabled in this environment. The platform requires development-mode writes to be switched on before this change is accepted.";
    case 409:
      return payload.message;
    case 412:
      return "This domain changed since you opened it. Reload to get the current version, then reapply your edit.";
    case 428:
      return "The change is missing its concurrency token. Reload and try again.";
    case 401:
      return "Your session has expired. Sign in again to continue.";
    case 0:
      return "The API could not be reached. Check that the backend is running, then try again.";
    default:
      return payload.message;
  }
}

export function DomainFormDialog({
  open,
  record,
  sites,
  onClose,
  onSaved,
}: DomainFormDialogProps) {
  const toast = useToast();
  const mode = record ? "edit" : "create";

  const [values, setValues] = useState<FormValues>({
    site: "",
    hostname: "",
    type: "alias",
    status: "ACTIVE",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The selected Site's current primary domain ("existing primary info").
  const [primary, setPrimary] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "failed" }
    | { state: "ready"; hostname?: string }
  >({ state: "idle" });

  // Reset to the record (edit) or blank defaults (add) whenever the dialog
  // opens, so a cancelled session never leaks values into the next one.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFailure(null);
    setConfirmOpen(false);
    if (record) {
      setValues({
        site: String(record.site),
        hostname: record.hostname,
        type: record.is_primary ? "primary" : "alias",
        status: record.status,
      });
    } else {
      setValues({
        site: sites[0] ? String(sites[0].id) : "",
        hostname: "",
        type: "alias",
        status: "ACTIVE",
      });
    }
  }, [open, record, sites]);

  const selectedSiteId = values.site === "" ? null : Number(values.site);

  useEffect(() => {
    if (!open || selectedSiteId === null) {
      setPrimary({ state: "idle" });
      return;
    }
    let cancelled = false;
    setPrimary({ state: "loading" });
    listSiteDomains(selectedSiteId, { is_primary: true }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPrimary({ state: "failed" });
        return;
      }
      const row = result.data.results[0];
      setPrimary({ state: "ready", hostname: row?.hostname });
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedSiteId]);

  const selectedSite = sites.find((site) => String(site.id) === values.site);

  /**
   * True when making this record primary would demote a *different*
   * existing primary — the case that needs operator confirmation.
   */
  const wouldChangePrimary =
    values.type === "primary" &&
    (record === null || !record.is_primary) &&
    primary.state === "ready" &&
    typeof primary.hostname === "string";

  /** Run local checks; returns the normalized hostname when valid. */
  function validate(): { hostname: string } | null {
    const next: Record<string, string> = {};
    if (values.site === "") {
      next.site = "Choose the site this domain belongs to.";
    }

    let hostname = record?.hostname ?? "";
    if (mode === "create") {
      const parsed = normalizeHostname(values.hostname);
      // Narrowing must be explicit: `error: string` may be falsy (""), so a
      // truthy check leaves the union unresolved for TypeScript.
      if (parsed.error !== undefined) next.hostname = parsed.error;
      else hostname = parsed.hostname;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { hostname };
  }

  function handleSubmit() {
    if (pending) return;
    const valid = validate();
    if (!valid) return;
    if (wouldChangePrimary && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    void commit(valid.hostname);
  }

  /**
   * Map a failed result onto field errors or a banner. Field details from
   * DRF (and the 409 duplicate body) are `{field: [messages]}` objects, so
   * they attach to the input that caused them.
   */
  function presentFailure(payload: ApiErrorPayload): void {
    const fields = fieldErrorsFrom(deserializeApiError(payload));
    if (payload.details && typeof payload.details === "object") {
      for (const [field, value] of Object.entries(
        payload.details as Record<string, unknown>,
      )) {
        if (Array.isArray(value) && value.length > 0) {
          fields[field] = value.map(String).join(" ");
        }
      }
    }
    const { non_field_errors: nonField, ...rest } = fields;
    if (Object.keys(rest).length > 0) setErrors(rest);
    if (nonField || Object.keys(rest).length === 0) {
      setFailure(nonField ?? describeFailure(payload));
    }
  }

  /** The write itself, run directly or after confirmation. */
  async function commit(hostname: string) {
    setPending(true);
    setFailure(null);
    setErrors({});
    try {
      if (mode === "create") {
        const created = await createSiteDomain(Number(values.site), {
          hostname,
          status: values.status,
        });
        if (!created.ok) {
          presentFailure(created.error);
          return;
        }

        if (values.type === "primary") {
          const promoted = await makeSiteDomainPrimary(
            Number(values.site),
            created.data.data.id,
          );
          if (!promoted.ok) {
            // The row exists — say so honestly and refresh the listing.
            onSaved();
            toast.warning(
              `Created ${hostname}, but it could not be made primary: ${promoted.error.message} Use Edit to retry.`,
            );
            onClose();
            return;
          }
        }

        toast.success(`Added ${hostname} to ${selectedSite?.code ?? "the site"}.`);
        onSaved();
        onClose();
        return;
      }

      // Edit: hostname, site and (when primary) type are locked above, so
      // only status and alias→primary are actionable.
      let changed = false;

      if (values.status !== record!.status) {
        const statusResult = await updateSiteDomain(record!.site, record!.id, {
          status: values.status,
        });
        if (!statusResult.ok) {
          presentFailure(statusResult.error);
          return;
        }
        changed = true;
      }

      if (!record!.is_primary && values.type === "primary") {
        const promoted = await makeSiteDomainPrimary(record!.site, record!.id);
        if (!promoted.ok) {
          presentFailure(promoted.error);
          return;
        }
        changed = true;
      }

      if (!changed) {
        toast.info("No changes to save.");
        onClose();
        return;
      }

      toast.success(`Saved ${record!.hostname}.`);
      onSaved();
      onClose();
    } finally {
      setPending(false);
    }
  }

  const typeDisabled = record?.is_primary === true;

  return (
    <>
      <Dialog
        open={open}
        onClose={pending ? undefined : onClose}
        aria-labelledby="domain-form-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="domain-form-title" sx={{ fontWeight: 700 }}>
          {mode === "create" ? "Add domain" : "Edit domain"}
        </DialogTitle>

        <DialogContent>
          <Box
            sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
          >
            <FormErrorSummary
              errors={errors}
              title="Check the form and try again"
              fieldIds={{
                site: "domain-site",
                hostname: "domain-hostname",
                type: "domain-type",
                status: "domain-status",
              }}
            />

            {failure ? (
              <Alert severity="error" role="alert">
                {failure}
              </Alert>
            ) : null}

            {/* Selected site — clearly displayed in both modes. */}
            <Box>
              <SelectFilter
                id="domain-site"
                label="Associated site"
                value={values.site}
                options={sites.map((site) => ({
                  value: String(site.id),
                  label: `${site.code} — ${site.name}`,
                }))}
                onChange={(value) =>
                  setValues((previous) => ({ ...previous, site: value }))
                }
                includeAll={false}
                disabled={mode === "edit"}
              />
              <Typography
                variant="caption"
                color={errors.site ? "error" : "text.secondary"}
                role={errors.site ? "alert" : undefined}
                sx={{ display: "block", mt: 0.5 }}
              >
                {errors.site ??
                  (mode === "edit"
                    ? "A domain cannot change Site. Add another domain on the target site instead."
                    : "All fields below apply to this site.")}
              </Typography>
            </Box>

            {/* Existing primary of the selected site. */}
            <Box
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                px: 1.5,
                py: 1,
                bgcolor: "action.hover",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Existing primary domain
              </Typography>
              {primary.state === "loading" ? (
                <Typography variant="body2" color="text.secondary" aria-live="polite">
                  Loading the site&apos;s primary domain…
                </Typography>
              ) : primary.state === "failed" ? (
                <Typography variant="body2" color="warning.main">
                  The site&apos;s primary domain could not be read — nothing is
                  guessed here.
                </Typography>
              ) : primary.state === "ready" && primary.hostname ? (
                <Typography
                  variant="body2"
                  sx={{ fontFamily: "monospace", fontWeight: 700 }}
                >
                  {primary.hostname}
                  {record && primary.hostname === record.hostname
                    ? " (this domain)"
                    : ""}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  This site has no primary domain yet.
                </Typography>
              )}
            </Box>

            <TextField
              id="domain-hostname"
              label="Hostname"
              value={values.hostname}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  hostname: event.target.value,
                }))
              }
              size="small"
              fullWidth
              required
              disabled={mode === "edit" || pending}
              error={Boolean(errors.hostname)}
              helperText={
                errors.hostname ??
                (mode === "edit"
                  ? "Hostnames are immutable — add another domain instead."
                  : "For example eth.uog.edu.et. Protocol, path and port are rejected; the value is normalized like the backend does.")
              }
              inputProps={{
                "aria-describedby": "domain-hostname-help",
                "aria-invalid": errors.hostname ? true : undefined,
                spellCheck: false,
              }}
              FormHelperTextProps={{ id: "domain-hostname-help" }}
            />

            <Box>
              <SelectFilter
                id="domain-type"
                label="Domain type"
                value={values.type}
                options={[
                  { value: "primary", label: "Primary" },
                  { value: "alias", label: "Alias" },
                ]}
                onChange={(value) =>
                  setValues((previous) => ({
                    ...previous,
                    type: value === "primary" ? "primary" : "alias",
                  }))
                }
                includeAll={false}
                disabled={typeDisabled || pending}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.5 }}
              >
                {typeDisabled
                  ? "A primary domain cannot be demoted here — designate another domain as primary to move the role."
                  : values.type === "primary"
                    ? "Making this the primary will remove the primary designation from the domain shown above."
                    : "Aliases may redirect to the primary."}
              </Typography>
            </Box>

            <Box>
              <SelectFilter
                id="domain-status"
                label="Status"
                value={values.status}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
                onChange={(value) =>
                  setValues((previous) => ({
                    ...previous,
                    status: value === "ACTIVE" ? "ACTIVE" : "INACTIVE",
                  }))
                }
                includeAll={false}
                disabled={pending}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.5 }}
              >
                Inactive domains stay registered but are not served.
              </Typography>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={pending} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={pending || sites.length === 0}
            onClick={handleSubmit}
          >
            {pending
              ? "Working…"
              : mode === "create"
                ? "Add domain"
                : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Change the site's primary domain?"
        description={`Making ${
          values.hostname && mode === "create"
            ? normalizeHostname(values.hostname).hostname || values.hostname
            : (record?.hostname ?? "this domain")
        } the primary will remove the primary designation from ${
          primary.state === "ready" ? primary.hostname : "the current primary"
        }. Routing for the site follows the primary domain.`}
        confirmLabel="Change primary"
        pending={pending}
        error={null}
        onConfirm={() => {
          setConfirmOpen(false);
          const valid = validate();
          if (valid) void commit(valid.hostname);
        }}
        onCancel={() => {
          if (!pending) setConfirmOpen(false);
        }}
      >
        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
          {selectedSite ? `${selectedSite.code} — ${selectedSite.name}` : ""}
        </Typography>
      </ConfirmDialog>
    </>
  );
}
