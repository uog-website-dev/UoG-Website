"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { defaultSiteStaffDirectorySettings, staffDirectorySettingsFrom } from "@uog/types";
import type { SiteStaffDirectorySettings, StaffDirectoryPresentation, StaffDirectorySort } from "@uog/types";
import { FormErrorSummary, fieldErrorsFrom } from "@uog/ui";
import {
  getSiteStaffDirectorySettings,
  updateSiteStaffDirectorySettings,
} from "@/app/sites/staff-directory-actions";
import type { SiteStaffDirectorySettingsEnvelope } from "@/app/sites/staff-directory-actions";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteStaffDirectoryNav } from "@/sites/site-staff-directory-nav";

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error;
  return result.data;
}

export function SiteStaffDirectorySettingsPanel() {
  const { site } = useSiteAdmin();
  return <StaffDirectorySettingsEditor key={site.id} siteId={site.id} siteName={site.name} />;
}

function StaffDirectorySettingsEditor({ siteId, siteName }: { siteId: number; siteName: string }) {
  const [loaded, setLoaded] = useState<SiteStaffDirectorySettingsEnvelope | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [values, setValues] = useState<SiteStaffDirectorySettings>(defaultSiteStaffDirectorySettings);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void getSiteStaffDirectorySettings(siteId)
      .then((settingsResult) => {
        if (!active) return;
        const settings = unwrap(settingsResult);
        if (settings.data.site !== siteId) throw new Error("Staff Directory settings belong to another Site.");
        setLoaded(settings.data);
        setEtag(settings.etag);
        setValues(staffDirectorySettingsFrom(settings.data.settings));
      })
      .catch((cause) => { if (active) setError(cause); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [siteId]);

  async function saveSettings() {
    if (!etag) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await updateSiteStaffDirectorySettings(siteId, etag, values);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoaded(result.data.data);
    setEtag(result.data.etag);
    setValues(staffDirectorySettingsFrom(result.data.data.settings));
    setNotice("Directory settings saved for this Site.");
  }

  const set = <K extends keyof SiteStaffDirectorySettings>(key: K, value: SiteStaffDirectorySettings[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const fields = fieldErrorsFrom(error);
  const scope = loaded?.scope;

  return (
    <Stack spacing={3}>
      <SiteStaffDirectoryNav
        title="Directory Settings"
        description={`Page size, sort, public route, presentation and aggregation eligibility for ${siteName}.`}
      />
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <FormErrorSummary error={error} /> : null}
      {!loaded && !error ? <Typography role="status">Loading Directory settings…</Typography> : null}
      {loaded ? (
        <Box component="section" aria-labelledby="staff-directory-settings-form" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560 }}>
          <Typography id="staff-directory-settings-form" variant="h6" component="h2">Configuration</Typography>
          <TextField
            label="Page size"
            type="number"
            value={values.page_size}
            onChange={(event) => set("page_size", Number(event.target.value))}
            error={Boolean(fields.page_size)}
            helperText={fields.page_size?.[0] ?? "Between 5 and 100 profiles per public page"}
            disabled={busy}
            fullWidth
            inputProps={{ min: 5, max: 100, step: 1 }}
          />
          <FormControl fullWidth disabled={busy} error={Boolean(fields.default_sort)}>
            <InputLabel id="staff-default-sort-label">Default sort</InputLabel>
            <Select
              labelId="staff-default-sort-label"
              label="Default sort"
              value={values.default_sort}
              onChange={(event) => set("default_sort", event.target.value as StaffDirectorySort)}
            >
              <MenuItem value="NAME_ASC">Name (A–Z)</MenuItem>
              <MenuItem value="NAME_DESC">Name (Z–A)</MenuItem>
              <MenuItem value="TITLE_ASC">Title (A–Z)</MenuItem>
              <MenuItem value="DEPARTMENT_ASC">Department (A–Z)</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Public directory route"
            value={values.public_list_path}
            onChange={(event) => set("public_list_path", event.target.value)}
            error={Boolean(fields.public_list_path)}
            helperText={fields.public_list_path?.[0] ?? "Same-site path visitors use for the Staff Directory"}
            disabled={busy}
            fullWidth
          />
          <FormControl fullWidth disabled={busy} error={Boolean(fields.presentation)}>
            <InputLabel id="staff-presentation-label">Presentation</InputLabel>
            <Select
              labelId="staff-presentation-label"
              label="Presentation"
              value={values.presentation}
              onChange={(event) => set("presentation", event.target.value as StaffDirectoryPresentation)}
            >
              <MenuItem value="LIST">List</MenuItem>
              <MenuItem value="CARDS">Cards</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={values.public_aggregation_eligible}
                onChange={(event) => set("public_aggregation_eligible", event.target.checked)}
                disabled={busy}
              />
            }
            label="Eligible for University Main public aggregation"
          />
          <Alert severity="info">
            Directory scope is resolved server-side from this Site&apos;s mapped Organization
            {scope?.organization_unit_id != null ? ` (#${scope.organization_unit_id})` : ""}.
            Mode: {scope?.mode ?? "mapped_organization"}. Aggregation write access:{" "}
            {loaded.aggregation_write_access ? "yes" : "no"}.
            {scope?.aggregation_site_ids?.length
              ? ` Eligible child Sites: ${scope.aggregation_site_ids.join(", ")}.`
              : " No aggregated child Sites."}
          </Alert>
          <Box>
            <Button variant="contained" onClick={() => void saveSettings()} disabled={busy || !etag}>
              Save Directory settings
            </Button>
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}
