"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { defaultSiteEventSettings, eventSettingsFrom } from "@uog/types";
import type { SiteEventCategory, SiteEventSettings } from "@uog/types";
import { FormErrorSummary, fieldErrorsFrom } from "@uog/ui";
import {
  deactivateSiteEventCategory,
  getSiteEventSettings,
  listSiteEventCategories,
  saveSiteEventCategory,
  updateSiteEventSettings,
} from "@/app/sites/event-actions";
import type { SiteEventSettingsEnvelope } from "@/app/sites/event-actions";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteEventsNav } from "@/sites/site-events-nav";

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error;
  return result.data;
}

export function SiteEventSettingsPanel() {
  const { site } = useSiteAdmin();
  return <EventSettingsEditor key={site.id} siteId={site.id} siteName={site.name} />;
}

function EventSettingsEditor({ siteId, siteName }: { siteId: number; siteName: string }) {
  const [loaded, setLoaded] = useState<SiteEventSettingsEnvelope | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [values, setValues] = useState<SiteEventSettings>(defaultSiteEventSettings);
  const [categories, setCategories] = useState<SiteEventCategory[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void Promise.all([getSiteEventSettings(siteId), listSiteEventCategories(siteId)])
      .then(([settingsResult, categoriesResult]) => {
        if (!active) return;
        const settings = unwrap(settingsResult);
        if (settings.data.site !== siteId) throw new Error("Event settings belong to another Site.");
        setLoaded(settings.data);
        setEtag(settings.etag);
        setValues(eventSettingsFrom(settings.data.settings));
        setCategories(unwrap(categoriesResult));
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
    const result = await updateSiteEventSettings(siteId, etag, values);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoaded(result.data.data);
    setEtag(result.data.etag);
    setValues(eventSettingsFrom(result.data.data.settings));
    setNotice("Event settings saved for this Site.");
  }

  async function addCategory() {
    const name = categoryName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const result = await saveSiteEventCategory(siteId, { name });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCategoryName("");
    setCategories((previous) => [...previous, result.data].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
    setNotice("Event category added.");
  }

  async function deactivateCategory(categoryId: string) {
    setBusy(true);
    setError(null);
    const result = await deactivateSiteEventCategory(siteId, categoryId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCategories((previous) => previous.map((row) => row.id === categoryId ? { ...row, is_active: false } : row));
    setNotice("Event category deactivated.");
  }

  const set = <K extends keyof SiteEventSettings>(key: K, value: SiteEventSettings[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const fields = fieldErrorsFrom(error);

  return (
    <Stack spacing={3}>
      <SiteEventsNav
        title="Event Settings"
        description={`Default timezone, public list route, registration defaults and categories for ${siteName}.`}
      />
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <FormErrorSummary error={error} /> : null}
      {!loaded && !error ? <Typography role="status">Loading Event settings…</Typography> : null}
      {loaded ? (
        <Box component="section" aria-labelledby="event-settings-form" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560 }}>
          <Typography id="event-settings-form" variant="h6" component="h2">Configuration</Typography>
          <TextField
            label="Default timezone"
            value={values.timezone}
            onChange={(event) => set("timezone", event.target.value)}
            error={Boolean(fields.timezone)}
            helperText={fields.timezone?.[0] ?? "IANA timezone such as Africa/Addis_Ababa"}
            disabled={busy}
            fullWidth
          />
          <TextField
            label="Public list route"
            value={values.public_list_path}
            onChange={(event) => set("public_list_path", event.target.value)}
            error={Boolean(fields.public_list_path)}
            helperText={fields.public_list_path?.[0] ?? "Same-site path visitors use for the Event list"}
            disabled={busy}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={values.registration_required_by_default}
                onChange={(event) => set("registration_required_by_default", event.target.checked)}
                disabled={busy}
              />
            }
            label="Require registration by default"
          />
          <TextField
            label="Default registration capacity"
            type="number"
            value={values.registration_default_capacity ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim();
              set("registration_default_capacity", raw === "" ? null : Number(raw));
            }}
            error={Boolean(fields.registration_default_capacity)}
            helperText={fields.registration_default_capacity?.[0] ?? "Leave blank for unlimited"}
            disabled={busy}
            fullWidth
            inputProps={{ min: 1, step: 1 }}
          />
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
          <FormControlLabel
            control={
              <Switch
                checked={values.block_publish_on_session_room_conflicts}
                onChange={(event) => set("block_publish_on_session_room_conflicts", event.target.checked)}
                disabled={busy}
              />
            }
            label="Block publish when sessions overlap in the same room"
          />
          <FormControlLabel
            control={
              <Switch
                checked={values.hide_cancelled_sessions_publicly}
                onChange={(event) => set("hide_cancelled_sessions_publicly", event.target.checked)}
                disabled={busy}
              />
            }
            label="Hide cancelled sessions from the public agenda"
          />
          <Alert severity="info">
            Aggregation eligibility only allows University Main to list this Site&apos;s published Events.
            It never grants another Site write access. Current write access from aggregation: {loaded.aggregation_write_access ? "yes" : "no"}.
          </Alert>
          <Box>
            <Button variant="contained" onClick={() => void saveSettings()} disabled={busy || !etag}>
              Save Event settings
            </Button>
          </Box>
        </Box>
      ) : null}
      {loaded ? (
        <Box component="section" aria-labelledby="event-categories" sx={{ display: "flex", flexDirection: "column", gap: 1.5, maxWidth: 560 }}>
          <Typography id="event-categories" variant="h6" component="h2">Event categories</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              label="New category"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              disabled={busy}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={() => void addCategory()} disabled={busy || !categoryName.trim()}>
              Add
            </Button>
          </Box>
          {categories.length === 0 ? (
            <Typography color="text.secondary">No Event categories yet.</Typography>
          ) : (
            <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
              {categories.map((category) => (
                <Box
                  component="li"
                  key={category.id}
                  sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
                >
                  <Typography>
                    {category.name}
                    {!category.is_active ? " (inactive)" : ""}
                  </Typography>
                  {category.is_active ? (
                    <Button size="small" onClick={() => void deactivateCategory(category.id)} disabled={busy}>
                      Deactivate
                    </Button>
                  ) : null}
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}
    </Stack>
  );
}
