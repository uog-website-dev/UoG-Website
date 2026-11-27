"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { emptyEventInput } from "@uog/types";
import type { EventFormat, SiteEventInput, SiteEventRecord } from "@uog/types";
import { FormErrorSummary, fieldErrorsFrom, useToast } from "@uog/ui";
import { listSiteEventCategories } from "@/app/sites/event-actions";
import {
  createSiteEvent,
  eventWorkflow,
  getSiteEvent,
  previewSiteEvent,
  updateSiteEvent,
} from "@/app/sites/event-record-actions";
import { getSiteEventSettings } from "@/app/sites/event-actions";
import { eventAdminHref } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteEventsNav } from "@/sites/site-events-nav";
import { SiteEventPeople } from "@/sites/site-event-people";
import { SiteEventRegistrations } from "@/sites/site-event-registrations";
import { SiteEventResources } from "@/sites/site-event-resources";
import { SiteEventSchedule } from "@/sites/site-event-schedule";

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error;
  return result.data;
}

function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function SiteEventEditorPage({
  siteId,
  mode,
  eventId,
}: {
  siteId: number;
  mode: "create" | "edit" | "preview";
  eventId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { site } = useSiteAdmin();
  const [values, setValues] = useState<SiteEventInput>(emptyEventInput());
  const [record, setRecord] = useState<SiteEventRecord | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    setBusy(true);
    void Promise.all([
      listSiteEventCategories(siteId),
      getSiteEventSettings(siteId),
      mode !== "create" && eventId ? (mode === "preview" ? previewSiteEvent(siteId, eventId) : getSiteEvent(siteId, eventId)) : null,
    ]).then(([categoryResult, settingsResult, eventResult]) => {
      if (!active) return;
      setCategories(unwrap(categoryResult));
      const settings = unwrap(settingsResult).data.settings as {
        timezone: string;
        registration_required_by_default: boolean;
        registration_default_capacity: number | null;
      };
      if (eventResult) {
        const loaded = mode === "preview"
          ? unwrap(eventResult as Awaited<ReturnType<typeof previewSiteEvent>>)
          : unwrap(eventResult as Awaited<ReturnType<typeof getSiteEvent>>);
        if (mode === "preview") {
          setRecord(loaded as SiteEventRecord);
          setValues(loaded as SiteEventInput);
        } else {
          const envelope = loaded as { data: SiteEventRecord; etag: string | null };
          setRecord(envelope.data);
          setEtag(envelope.etag);
          setValues({
            title: envelope.data.title,
            slug: envelope.data.slug,
            summary: envelope.data.summary,
            description: envelope.data.description,
            category: envelope.data.category,
            organizer_name: envelope.data.organizer_name,
            organizer_email: envelope.data.organizer_email,
            organizer_phone: envelope.data.organizer_phone,
            starts_at: envelope.data.starts_at,
            ends_at: envelope.data.ends_at,
            timezone: envelope.data.timezone,
            venue: envelope.data.venue,
            format: envelope.data.format,
            online_url: envelope.data.online_url,
            banner_asset: envelope.data.banner_asset,
            registration_required: envelope.data.registration_required,
            registration_capacity: envelope.data.registration_capacity,
            registration_open: envelope.data.registration_open,
            registration_opens_at: envelope.data.registration_opens_at,
            registration_closes_at: envelope.data.registration_closes_at,
            waitlist_enabled: envelope.data.waitlist_enabled,
            registration_category: envelope.data.registration_category,
            registration_notice: envelope.data.registration_notice,
          });
        }
      } else {
        setValues((previous) => ({
          ...previous,
          timezone: settings.timezone,
          registration_required: settings.registration_required_by_default,
          registration_capacity: settings.registration_default_capacity,
          registration_open: true,
          waitlist_enabled: false,
        }));
      }
    }).catch((cause) => { if (active) setError(cause); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [siteId, mode, eventId]);

  const set = <K extends keyof SiteEventInput>(key: K, value: SiteEventInput[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const fields = fieldErrorsFrom(error);
  const readOnly = mode === "preview";

  async function save(publish = false) {
    setBusy(true);
    setError(null);
    const payload: SiteEventInput = {
      ...values,
      starts_at: typeof values.starts_at === "string" && values.starts_at && !values.starts_at.includes("T")
        ? values.starts_at
        : values.starts_at,
      ends_at: values.ends_at,
    };
    const result = mode === "create"
      ? await createSiteEvent(siteId, payload)
      : await updateSiteEvent(siteId, eventId!, etag ?? "", payload);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    setRecord(result.data.data);
    setEtag(result.data.etag);
    if (publish) {
      const published = await eventWorkflow(siteId, result.data.data.id, "publish", result.data.etag ?? undefined);
      setBusy(false);
      if (!published.ok) {
        setError(published.error);
        return;
      }
      toast.success("Event published.");
      router.push(eventAdminHref(siteId));
      return;
    }
    setBusy(false);
    toast.success(mode === "create" ? "Draft saved." : "Event updated.");
    if (mode === "create") router.push(`${eventAdminHref(siteId)}/${result.data.data.id}/edit`);
  }

  return (
    <Stack spacing={3}>
      <SiteEventsNav
        title={mode === "create" ? "Add New Event" : mode === "preview" ? "Event Preview" : "Edit Event"}
        description={`${mode === "preview" ? "Authenticated preview for" : "Edit identity, timing, location and banner for"} ${site.name}.`}
      />
      {record?.status === "CANCELLED" ? (
        <Alert severity="warning">{record.cancellation_notice || "This Event has been cancelled."}</Alert>
      ) : null}
      {mode === "preview" ? (
        <Alert severity="info">This preview is authenticated and never available on public anonymous routes.</Alert>
      ) : null}
      {error ? <FormErrorSummary error={error} /> : null}
      <Box component="section" aria-labelledby="event-identity" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <Typography id="event-identity" variant="h6" component="h2">Identity</Typography>
        <TextField label="Title" value={values.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.title)} helperText={fields.title?.[0]} fullWidth />
        <TextField label="Slug" value={values.slug ?? ""} onChange={(e) => set("slug", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.slug)} helperText={fields.slug?.[0] ?? "Unique within this Site"} fullWidth />
        <TextField label="Summary" value={values.summary ?? ""} onChange={(e) => set("summary", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.summary)} helperText={fields.summary?.[0]} fullWidth multiline minRows={2} />
        <TextField label="Description" value={values.description ?? ""} onChange={(e) => set("description", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.description)} helperText={fields.description?.[0] ?? "HTML is sanitized on save"} fullWidth multiline minRows={5} />
        <TextField select label="Category" value={values.category ?? ""} onChange={(e) => set("category", e.target.value || null)} disabled={busy || readOnly} fullWidth>
          <MenuItem value="">No category</MenuItem>
          {categories.filter((row) => row.is_active).map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}
        </TextField>
      </Box>
      <Box component="section" aria-labelledby="event-timing" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <Typography id="event-timing" variant="h6" component="h2">Timing</Typography>
        <TextField label="Timezone" value={values.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.timezone)} helperText={fields.timezone?.[0]} fullWidth />
        <TextField label="Starts" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(values.starts_at)} onChange={(e) => set("starts_at", fromLocalInput(e.target.value))} disabled={busy || readOnly} error={Boolean(fields.starts_at)} helperText={fields.starts_at?.[0]} fullWidth />
        <TextField label="Ends" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(values.ends_at)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value))} disabled={busy || readOnly} error={Boolean(fields.ends_at)} helperText={fields.ends_at?.[0]} fullWidth />
      </Box>
      <Box component="section" aria-labelledby="event-location" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <Typography id="event-location" variant="h6" component="h2">Location and format</Typography>
        <TextField select label="Format" value={values.format ?? "PHYSICAL"} onChange={(e) => set("format", e.target.value as EventFormat)} disabled={busy || readOnly} fullWidth>
          <MenuItem value="PHYSICAL">Physical</MenuItem>
          <MenuItem value="ONLINE">Online</MenuItem>
          <MenuItem value="HYBRID">Hybrid</MenuItem>
        </TextField>
        <TextField label="Venue" value={values.venue ?? ""} onChange={(e) => set("venue", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.venue)} helperText={fields.venue?.[0]} fullWidth />
        <TextField label="Online URL" value={values.online_url ?? ""} onChange={(e) => set("online_url", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.online_url)} helperText={fields.online_url?.[0]} fullWidth />
        <TextField label="Banner media asset ID" value={values.banner_asset ?? ""} onChange={(e) => set("banner_asset", e.target.value || null)} disabled={busy || readOnly} error={Boolean(fields.banner_asset)} helperText={fields.banner_asset?.[0] ?? "Paste a Site Media Library image asset UUID"} fullWidth />
        {record?.banner_url ? <Box component="img" src={record.banner_url} alt="" sx={{ maxWidth: 360, borderRadius: 1 }} /> : null}
      </Box>
      <Box component="section" aria-labelledby="event-organizer" sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <Typography id="event-organizer" variant="h6" component="h2">Organizer and registration</Typography>
        <TextField label="Organizer name" value={values.organizer_name ?? ""} onChange={(e) => set("organizer_name", e.target.value)} disabled={busy || readOnly} fullWidth />
        <TextField label="Organizer email" value={values.organizer_email ?? ""} onChange={(e) => set("organizer_email", e.target.value)} disabled={busy || readOnly} fullWidth />
        <TextField label="Organizer phone" value={values.organizer_phone ?? ""} onChange={(e) => set("organizer_phone", e.target.value)} disabled={busy || readOnly} fullWidth />
        <FormControlLabel control={<Switch checked={Boolean(values.registration_required)} onChange={(e) => set("registration_required", e.target.checked)} disabled={busy || readOnly} />} label="Enable registration" />
        <FormControlLabel control={<Switch checked={values.registration_open !== false} onChange={(e) => set("registration_open", e.target.checked)} disabled={busy || readOnly || !values.registration_required} />} label="Registration open" />
        <FormControlLabel control={<Switch checked={Boolean(values.waitlist_enabled)} onChange={(e) => set("waitlist_enabled", e.target.checked)} disabled={busy || readOnly || !values.registration_required} />} label="Enable waitlist when full" />
        <TextField label="Registration capacity" type="number" value={values.registration_capacity ?? ""} onChange={(e) => set("registration_capacity", e.target.value === "" ? null : Number(e.target.value))} disabled={busy || readOnly || !values.registration_required} fullWidth inputProps={{ min: 1 }} helperText="Leave blank for unlimited confirmed seats" />
        <TextField label="Registration opens" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(values.registration_opens_at ?? null)} onChange={(e) => set("registration_opens_at", fromLocalInput(e.target.value))} disabled={busy || readOnly || !values.registration_required} fullWidth />
        <TextField label="Registration closes" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(values.registration_closes_at ?? null)} onChange={(e) => set("registration_closes_at", fromLocalInput(e.target.value))} disabled={busy || readOnly || !values.registration_required} fullWidth />
        <TextField label="Registration category label" value={values.registration_category ?? ""} onChange={(e) => set("registration_category", e.target.value)} disabled={busy || readOnly || !values.registration_required} fullWidth helperText="Optional public label such as General admission" />
        <TextField label="Registration notice" value={values.registration_notice ?? ""} onChange={(e) => set("registration_notice", e.target.value)} disabled={busy || readOnly || !values.registration_required} fullWidth multiline minRows={2} />
      </Box>
      {mode !== "create" && eventId ? (
        <>
          {values.registration_required ? (
            <SiteEventRegistrations siteId={siteId} eventId={eventId} />
          ) : null}
          <SiteEventPeople siteId={siteId} eventId={eventId} readOnly={readOnly} />
          <SiteEventSchedule
            siteId={siteId}
            eventId={eventId}
            eventEtag={etag}
            onEventEtagChange={setEtag}
            readOnly={readOnly}
          />
          <SiteEventResources siteId={siteId} eventId={eventId} readOnly={readOnly} />
        </>
      ) : (
        <Alert severity="info">Save the Event draft first to manage speakers, schedule, and resources.</Alert>
      )}
      {!readOnly ? (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="contained" disabled={busy} onClick={() => void save(false)}>Save draft</Button>
          <Button variant="outlined" disabled={busy} onClick={() => void save(true)}>Save and publish</Button>
          <Button component={Link} href={eventAdminHref(siteId)} disabled={busy}>Back to All Events</Button>
        </Box>
      ) : (
        <Button component={Link} href={`${eventAdminHref(siteId)}/${eventId}/edit`}>Edit Event</Button>
      )}
    </Stack>
  );
}
