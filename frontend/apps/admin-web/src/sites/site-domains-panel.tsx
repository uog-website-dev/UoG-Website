"use client";

/**
 * Per-site domain lifecycle management.
 *
 * This panel is the single place where an administrator activates,
 * deactivates and re-designates a Site's hostnames:
 *
 *   - every alias carries a "Set as primary" action, confirmed first with
 *     the current primary and the proposed replacement named side by side;
 *   - the switch runs through the backend's atomic `set-primary` action, so
 *     the Site always keeps exactly one primary, even on a lost race — a
 *     stale ETag answers 412 and is shown instead of being retried silently;
 *   - "Deactivate" on the active primary REQUIRES choosing a replacement
 *     from the Site's other active domains before the change can be
 *     submitted (the backend independently re-checks and rejects the change
 *     otherwise — the message is surfaced verbatim);
 *   - an inactive domain carries "Activate";
 *   - an active domain carries a direct link to the public website built
 *     from the configured canonical hostname.
 *
 * The read composes every page of the site's domains (see
 * `listAllSiteDomains`), because lifecycle decisions must see the whole set:
 * which row is primary and which rows may replace it never depend on what
 * happens to fit on page one.
 *
 * While any domain change is in flight (or a confirmation is open) every row
 * action is disabled, so two conflicting lifecycle operations can never be
 * issued at once. After a successful change the panel reloads its rows and
 * calls `onChanged`, whose owner refreshes the site profile and any content
 * derived from the primary domain.
 *
 * A domain row remains routing data only: nothing here claims that DNS or
 * TLS exists, and the platform provisions neither.
 */
import { useState } from "react";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ConfirmDialog, SelectFilter, useAsync, useToast } from "@uog/ui";
import type { Site, SiteDomain, SiteDomainStatus } from "@uog/types";

import {
  activateSiteDomain,
  deactivateSiteDomain,
  listAllSiteDomains,
  makeSiteDomainPrimary,
} from "@/app/sites/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";

export interface SiteDomainsPanelProps {
  site: Site;
  /** Called after any successful domain change so dependents can refresh. */
  onChanged?: () => void;
}

/** Lifecycle actions one domain row can run, mirrored by the backend. */
type DomainAction = "activate" | "deactivate" | "set-primary";

/** The confirmation currently open, if any. */
interface ConfirmRequest {
  kind: DomainAction;
  domain: SiteDomain;
}

/**
 * The public URL of an active domain, built from the configured canonical
 * hostname. The platform stores bare hostnames and owns neither DNS nor TLS,
 * so the scheme is not guessed: the link is protocol-relative and inherits
 * whatever scheme the administration console itself is served with, which
 * matches how nginx fronts the platform in each environment.
 */
export function publicWebsiteUrl(hostname: string): string {
  return `//${hostname}`;
}

/** Medium timestamps in UTC, like the site profile uses. */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date);
}

/**
 * The backend's handled errors are `{error:{code,message,details},…}`, and
 * for validation failures the actionable sentence lives in `details`
 * (`{"replacement": ["Select an active domain …"]}`) while the top-level
 * message is a generic status line ("The request is invalid."). Append the
 * detail sentences so the operator always sees the rule they broke.
 */
function withDetailSentences(payload: ApiErrorPayload): ApiErrorPayload {
  if (payload.details === null || typeof payload.details !== "object") {
    return payload;
  }
  const sentences = Object.values(
    payload.details as Record<string, unknown>,
  ).flatMap((value) => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
  });
  const useful = sentences.filter((sentence) => sentence.trim() !== "");
  if (useful.length === 0) return payload;
  return { ...payload, message: `${payload.message} ${useful.join(" ")}` };
}

export function SiteDomainsPanel({ site, onChanged }: SiteDomainsPanelProps) {
  const toast = useToast();

  // The whole domain set for this site (all pages), the basis for the
  // primary display, the eligibility of actions and the replacement picker.
  const domains = useAsync<SiteDomain[]>(
    async () => unwrap(await listAllSiteDomains(site.id)),
    [site.id],
  );

  // One confirm flow at a time; `pending` identifies the row write in
  // flight. Both together disable every row action, so conflicting
  // operations cannot be issued while a change is running.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmError, setConfirmError] = useState<ApiErrorPayload | null>(null);
  const [replacementId, setReplacementId] = useState<string>("");
  const [pending, setPending] = useState<{ id: number; kind: DomainAction } | null>(
    null,
  );

  const rows = domains.data ?? [];
  const currentPrimary = rows.find((row) => row.is_primary) ?? null;
  const busy = pending !== null || confirm !== null;

  /** Other active domains of this Site — the only valid replacements for
   * deactivating the active primary (the backend re-checks both rules). */
  const replacements = rows.filter(
    (row) => row.status === ("ACTIVE" as SiteDomainStatus) && row.id !== confirm?.domain.id,
  );

  /** Open a confirmation. Never while another action runs. */
  function openConfirm(kind: DomainAction, domain: SiteDomain) {
    if (busy) return;
    setConfirmError(null);
    setReplacementId("");
    setConfirm({ kind, domain });
  }

  /**
   * Run the confirmed lifecycle change. Each action goes through a server
   * wrapper that fetches the row's current strong ETag first, so a stale row
   * answers 412 (surfaced verbatim) instead of silently overwriting.
   */
  async function runConfirmedAction() {
    if (!confirm || pending) return;
    const { kind, domain } = confirm;
    // Backstop for the in-dialog prevention: the active primary cannot be
    // deactivated without a chosen replacement.
    if (kind === "deactivate" && domain.is_primary && replacementId === "") {
      return;
    }
    const replacement =
      kind === "deactivate" && domain.is_primary
        ? (rows.find((row) => String(row.id) === replacementId) ?? null)
        : null;

    setPending({ id: domain.id, kind });
    setConfirmError(null);
    try {
      const result =
        kind === "activate"
          ? await activateSiteDomain(site.id, domain.id)
          : kind === "deactivate"
            ? await deactivateSiteDomain(site.id, domain.id, replacement?.id)
            : await makeSiteDomainPrimary(site.id, domain.id);

      if (!result.ok) {
        setConfirmError(withDetailSentences(result.error));
        return;
      }

      toast.success(successMessage(kind, domain, replacement));
      setConfirm(null);
      setConfirmError(null);
      domains.reload();
      onChanged?.();
    } finally {
      setPending(null);
    }
  }

  /** Plain-language result of the change that just succeeded. */
  function successMessage(
    kind: DomainAction,
    domain: SiteDomain,
    replacement: SiteDomain | null,
  ): string {
    switch (kind) {
      case "activate":
        return `Activated ${domain.hostname}.`;
      case "deactivate":
        return replacement
          ? `Deactivated ${domain.hostname}. ${replacement.hostname} is now the site's primary domain.`
          : `Deactivated ${domain.hostname}.`;
      case "set-primary": {
        const previous =
          currentPrimary && currentPrimary.id !== domain.id
            ? ` ${currentPrimary.hostname} keeps serving as an alias.`
            : "";
        return `Primary domain changed to ${domain.hostname}.${previous}`;
      }
    }
  }

  // ------------------------------ confirm copy -----------------------------

  function confirmTitle(kind: DomainAction): string {
    switch (kind) {
      case "activate":
        return "Activate domain?";
      case "deactivate":
        return "Deactivate domain?";
      case "set-primary":
        return "Change the site's primary domain?";
    }
  }

  function confirmDescription(kind: DomainAction, domain: SiteDomain): string {
    switch (kind) {
      case "activate":
        return `${domain.hostname} becomes servable again. Activation changes this routing record only — it does not provision DNS or TLS. On an archived site the server refuses the change and the reason is shown here.`;
      case "deactivate":
        return domain.is_primary
          ? `${domain.hostname} is this site's active primary domain. Deactivating it requires choosing another active domain as the replacement — that domain becomes the primary in the same change, so the site keeps exactly one primary.`
          : `${domain.hostname} stops being served. The site keeps its other active domains. It can be activated again.`;
      case "set-primary":
        return currentPrimary
          ? `Making ${domain.hostname} the primary removes the primary designation from ${currentPrimary.hostname}. Routing for the site follows the primary domain.`
          : `The site currently has no primary domain. Making ${domain.hostname} the primary points the site's routing there.`;
    }
  }

  // ------------------------------ row rendering ----------------------------

  function renderRow(domain: SiteDomain) {
    const actions: { label: string; onClick: () => void }[] = [];
    if (!domain.is_primary) {
      actions.push({
        label: "Set as primary",
        onClick: () => openConfirm("set-primary", domain),
      });
    }
    if (domain.status === "ACTIVE") {
      actions.push({
        label: "Deactivate",
        onClick: () => openConfirm("deactivate", domain),
      });
    } else {
      actions.push({
        label: "Activate",
        onClick: () => openConfirm("activate", domain),
      });
    }

    return (
      <Box
        component="li"
        key={domain.id}
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          pb: 1.5,
          "&:last-of-type": { borderBottom: 0, pb: 0 },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", fontWeight: 600 }}
          >
            {domain.hostname}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={domain.is_primary ? "primary" : "default"}
            label={domain.is_primary ? "Primary" : "Alias"}
            sx={{ fontWeight: 600 }}
          />
          <Chip
            size="small"
            variant="outlined"
            color={domain.status === "ACTIVE" ? "success" : "default"}
            label={domain.status === "ACTIVE" ? "Active" : "Inactive"}
          />
          {domain.redirect_to_primary ? (
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <WarningAmberRoundedIcon
                fontSize="small"
                sx={{ fontSize: 16, color: "warning.main" }}
                aria-hidden="true"
              />
              <Typography variant="caption" color="warning.main">
                Redirects to the primary domain
              </Typography>
            </Box>
          ) : null}
          {domain.status === "ACTIVE" ? (
            <Link
              href={publicWebsiteUrl(domain.hostname)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${domain.hostname}`}
              underline="hover"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <OpenInNewRoundedIcon sx={{ fontSize: 15 }} aria-hidden="true" />
              Public website
            </Link>
          ) : null}
          <Box
            sx={{
              ml: "auto",
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            {actions.map((action) => (
              <Button
                key={action.label}
                size="small"
                variant={
                  action.label === "Activate"
                    ? "contained"
                    : action.label === "Deactivate"
                      ? "outlined"
                      : "outlined"
                }
                color={
                  action.label === "Deactivate"
                    ? "warning"
                    : action.label === "Set as primary"
                      ? "primary"
                      : "primary"
                }
                disabled={busy}
                aria-label={`${action.label} ${domain.hostname}`}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Lifecycle: added {formatTimestamp(domain.created_at)} · last updated{" "}
          {formatTimestamp(domain.updated_at)}
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Domains
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hostnames registered for this site, with their lifecycle. A domain
            row is routing data only — it does not claim that DNS records or
            TLS certificates exist, and this platform does not provision
            them.
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          {domains.loading ? (
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              Loading domains…
            </Typography>
          ) : domains.error ? (
            <Alert severity="warning" variant="outlined">
              The domain list could not be loaded: {domains.error.message}
              {domains.error.requestId
                ? ` (reference ${domains.error.requestId})`
                : ""}
              . This is a read failure — it does not mean the site has no
              domains.
            </Alert>
          ) : rows.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No hostnames are registered for this site yet.
            </Alert>
          ) : (
            <Box
              component="ul"
              sx={{
                m: 0,
                p: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              {rows.map((domain) => renderRow(domain))}
            </Box>
          )}
        </Box>
      </Paper>

      {confirm ? (
        <ConfirmDialog
          open
          title={confirmTitle(confirm.kind)}
          description={confirmDescription(confirm.kind, confirm.domain)}
          confirmLabel={
            confirm.kind === "set-primary"
              ? "Set as primary"
              : confirm.kind === "activate"
                ? "Activate"
                : "Deactivate"
          }
          confirmColor={confirm.kind === "deactivate" ? "error" : "primary"}
          pending={pending?.kind === confirm.kind && pending.id === confirm.domain.id}
          error={
            confirmError ? deserializeApiError(confirmError) : null
          }
          onConfirm={() => {
            void runConfirmedAction();
          }}
          onCancel={() => {
            if (!pending) {
              setConfirm(null);
              setConfirmError(null);
            }
          }}
        >
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {site.code} — {site.name}
          </Typography>

          {confirm.kind === "set-primary" ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography variant="body2">
                New primary:{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {confirm.domain.hostname}
                </Box>
              </Typography>
              <Typography variant="body2">
                Current primary (stays as an alias):{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {currentPrimary ? currentPrimary.hostname : "—"}
                </Box>
              </Typography>
            </Box>
          ) : null}

          {confirm.kind === "deactivate" && confirm.domain.is_primary ? (
            replacements.length > 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                <SelectFilter
                  id="domain-replacement"
                  label="Replacement domain"
                  value={replacementId}
                  options={replacements.map((row) => ({
                    value: String(row.id),
                    label: row.hostname,
                  }))}
                  onChange={(value) => setReplacementId(value)}
                  includeAll={false}
                  disabled={pending !== null}
                />
                <Typography variant="caption" color="text.secondary">
                  The chosen domain becomes the site&apos;s primary in the same
                  change.
                </Typography>
              </Box>
            ) : (
              <Alert severity="warning" variant="outlined">
                This site has no other active domain. Activate one first — the
                server rejects the change without a valid replacement.
              </Alert>
            )
          ) : null}

          {confirm.kind === "set-primary" && confirm.domain.status !== "ACTIVE" ? (
            <Alert severity="warning" variant="outlined">
              {confirm.domain.hostname} is currently inactive — activate it
              after the switch to serve traffic.
            </Alert>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
