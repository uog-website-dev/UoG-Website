"use client";

/**
 * Homepage Settings: assign an eligible published Page as the Site root.
 * Eligibility and permission are rechecked by setSiteHomepage; failed
 * assignment keeps the confirmed selection and refreshes candidate status.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useToast } from "@uog/ui";

import { ApiError } from "@uog/api-client";
import { getSite } from "@/app/sites/actions";
import { getSitePage, loadSitePages, setSiteHomepage } from "@/app/sites/page-actions";
import type { SitePageRecord } from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";
import { siteAdminHref } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { ViewPublicSite } from "@/sites/view-public-site";

function eligibleCandidate(page: SitePageRecord): boolean {
  return page.status === "PUBLISHED" && Boolean(page.can_set_homepage);
}

export function SiteHomepagePanel() {
  const admin = useSiteAdmin();
  const toast = useToast();
  const siteId = admin.site.id;
  const [assignedId, setAssignedId] = useState<string | null>(admin.site.homepageId ?? null);
  const [selection, setSelection] = useState<string>("");
  const [pages, setPages] = useState<SitePageRecord[]>([]);
  const [assignedPage, setAssignedPage] = useState<SitePageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const loadSequence = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const [siteResult, listed] = await Promise.all([
        getSite(siteId),
        loadSitePages(siteId, { status: "PUBLISHED", page: 1, page_size: 100, ordering: "title" }),
      ]);
      if (!alive.current || sequence !== loadSequence.current) return;
      const homepageId = siteResult.ok ? (siteResult.data.data.homepage ?? null) : (admin.site.homepageId ?? null);
      const rows = unwrap(listed).results.filter((page) => page.site === siteId);
      setPages(rows);
      setAssignedId(homepageId);
      let current: SitePageRecord | null = rows.find((page) => page.id === homepageId) ?? null;
      if (homepageId && !current) {
        try {
          current = unwrap(await getSitePage(siteId, homepageId));
        } catch {
          current = null;
        }
      }
      if (!alive.current || sequence !== loadSequence.current) return;
      setAssignedPage(current);
      setSelection((value) => {
        if (value && rows.some((page) => page.id === value && eligibleCandidate(page))) return value;
        if (homepageId && rows.some((page) => page.id === homepageId && eligibleCandidate(page))) return homepageId;
        const first = rows.find(eligibleCandidate);
        return first?.id ?? "";
      });
    } catch (cause) {
      if (alive.current && sequence === loadSequence.current) {
        setError(cause instanceof Error ? cause.message : "Homepage settings could not be loaded.");
      }
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [siteId, admin.site.homepageId]);

  useEffect(() => {
    setAssignedId(admin.site.homepageId ?? null);
    setSelection("");
    setPages([]);
    setAssignedPage(null);
    setMessage("");
    setError("");
    void reload();
  }, [siteId, admin.site.homepageId, reload]);

  const candidates = useMemo(() => pages.filter(eligibleCandidate), [pages]);
  const selectionIntact = Boolean(selection && (candidates.some((page) => page.id === selection) || selection === assignedId));
  const assignedLostEligibility = Boolean(
    assignedId && (
      !assignedPage
      || assignedPage.status !== "PUBLISHED"
      || assignedPage.visibility === "HIDDEN"
      || !pages.some((page) => page.id === assignedId)
    ),
  );

  async function assign() {
    if (!selection || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const confirmed = selection;
    try {
      const updated = unwrap(await setSiteHomepage(siteId, confirmed));
      if (!alive.current) return;
      setAssignedId(updated.id);
      setAssignedPage(updated);
      setSelection(updated.id);
      setMessage(`“${updated.title}” is now the homepage for ${admin.site.name}.`);
      toast.success(`Homepage assigned: ${updated.title}`);
      await reload();
    } catch (cause) {
      if (!alive.current) return;
      const details = cause instanceof ApiError && cause.fieldErrors
        ? [...new Set(Object.values(cause.fieldErrors).flat())].join(" ")
        : "";
      const text = details || (cause instanceof Error ? cause.message : "The homepage could not be assigned.");
      toast.error(text);
      await reload();
      if (!alive.current) return;
      setSelection(confirmed);
      setError(`${text} Your selection is unchanged.`);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  if (loading && pages.length === 0 && !assignedPage) {
    return (
      <Paper role="status" sx={{ p: 4, display: "flex", alignItems: "center", gap: 2 }}>
        <CircularProgress size={22} /> Loading Homepage Settings for {admin.site.name}…
      </Paper>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }} aria-label="Homepage Settings">
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, display: "grid", gap: 1.5 }}>
        <Typography variant="overline" color="text.secondary">Site root assignment</Typography>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>Homepage Settings</Typography>
        <Typography variant="body2" color="text.secondary">
          {admin.site.name} · {admin.site.code}
          {admin.site.primaryDomain?.hostname ? ` · ${admin.site.primaryDomain.hostname}` : " · no primary domain"}
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button component={Link} href={siteAdminHref(siteId)} size="small">Dashboard</Button>
          <Button component={Link} href={siteAdminHref(siteId, "pages")} size="small">Pages</Button>
          <ViewPublicSite
            siteName={admin.site.name}
            siteStatus={admin.site.status}
            primaryDomain={admin.site.primaryDomain}
            compact
            label="Public Preview"
          />
        </Box>
      </Paper>

      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
      {message ? <Alert severity="success" role="status">{message}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, display: "grid", gap: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Current assignment</Typography>
        {assignedId && assignedPage ? (
          <>
            <Typography>
              <strong>{assignedPage.title}</strong> · {assignedPage.path} · {assignedPage.status}
              {assignedPage.is_homepage ? " · marked homepage" : ""}
            </Typography>
            {assignedLostEligibility ? (
              <Alert severity="warning" role="status">
                This assignment is retained, but the Page is no longer eligible for public root delivery.
                Publish and restore eligibility, or choose another published Page. Public Preview may show the empty-root fallback.
              </Alert>
            ) : (
              <Alert severity="info" role="status">
                Eligible published Page. Public Preview for this Site serves this root when the Site and domain are active.
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button component={Link} href={`${siteAdminHref(siteId, "pages")}`} size="small">
                Open in Pages
              </Button>
              {admin.enabledModuleCodes.includes("VISUAL_BUILDER") ? (
                <Button
                  component={Link}
                  href={`/sites/${siteId}/admin/pages/${assignedPage.id}/builder`}
                  size="small"
                  disabled={!admin.permissions.includes("content.pages.update")}
                >
                  Open Page editor
                </Button>
              ) : null}
            </Box>
          </>
        ) : assignedId ? (
          <Alert severity="warning" role="status">
            Homepage Page {assignedId} is configured but could not be loaded in this Site. The pointer is unchanged.
          </Alert>
        ) : (
          <Typography color="text.secondary">No homepage is assigned for this Site yet.</Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, display: "grid", gap: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Assign published Page</Typography>
        <Typography variant="body2" color="text.secondary">
          Only same-Site published Pages the API marks as eligible appear here. Draft, hidden and foreign Pages are excluded.
        </Typography>
        {candidates.length === 0 ? (
          <Alert severity="info">
            No eligible published Pages are available. Publish a PUBLIC or UNLISTED Page from Pages, then return here.
          </Alert>
        ) : (
          <TextField
            select
            label="Eligible Page"
            value={selectionIntact ? selection : ""}
            disabled={saving}
            helperText={selectionIntact ? "Confirmed selection stays selected if assignment fails." : "Choose an eligible Page."}
            onChange={(event) => setSelection(event.target.value)}
          >
            {candidates.map((page) => (
              <MenuItem key={page.id} value={page.id}>
                {page.title} · {page.path}{page.id === assignedId ? " (current)" : ""}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            variant="contained"
            disabled={saving || !selection || selection === assignedId || !candidates.some((page) => page.id === selection)}
            onClick={() => void assign()}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {saving ? "Assigning…" : "Assign homepage"}
          </Button>
          <Button size="small" disabled={saving || loading} onClick={() => void reload()}>Refresh eligibility</Button>
        </Box>
      </Paper>
    </Box>
  );
}
