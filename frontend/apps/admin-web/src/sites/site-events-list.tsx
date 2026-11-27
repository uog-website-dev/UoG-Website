"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SiteEventRecord } from "@uog/types";
import { FormErrorSummary, useToast } from "@uog/ui";
import { listSiteEventCategories } from "@/app/sites/event-actions";
import { eventWorkflow, listSiteEvents } from "@/app/sites/event-record-actions";
import { useSiteQuery } from "@/data/query-cache";
import { eventAdminHref } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteEventsNav } from "@/sites/site-events-nav";
import { SiteEventEditorPage } from "./site-event-editor";

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error;
  return result.data;
}

export function SiteEventsList() {
  const { site } = useSiteAdmin();
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const categories = useSiteQuery(site.id, "event-categories", {}, async () =>
    unwrap(await listSiteEventCategories(site.id)),
  );
  const listed = useSiteQuery(
    site.id,
    "events",
    { search, status, category, dateFrom, dateTo, page, refresh },
    async () =>
      unwrap(await listSiteEvents(site.id, {
        search: search || undefined,
        status: status || undefined,
        category: category || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        page_size: 20,
      })),
  );

  async function runAction(event: SiteEventRecord, action: "duplicate" | "archive" | "publish" | "cancel") {
    setBusyId(event.id);
    setError(null);
    const etag = `"site-event-${site.id}-${event.id}-v${event.version}"`;
    const result = await eventWorkflow(
      site.id,
      event.id,
      action,
      action === "duplicate" ? undefined : etag,
      action === "cancel" ? { notice: "This Event has been cancelled." } : {},
    );
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (action === "duplicate") {
      toast.success("Event duplicated as a draft.");
      router.push(`${eventAdminHref(site.id)}/${result.data.data.id}/edit`);
      return;
    }
    toast.success(`Event ${action}d.`);
    setRefresh((value) => value + 1);
  }

  const rows = listed.data?.results ?? [];
  const count = listed.data?.count ?? 0;

  return (
    <Stack spacing={3}>
      <SiteEventsNav title="All Events" description={`Administer Events for ${site.name}.`} />
      {error ? <FormErrorSummary error={error} /> : null}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <TextField size="small" label="Search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 140 }}>
          <MenuItem value="">All statuses</MenuItem>
          {["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"].map((code) => (
            <MenuItem key={code} value={code}>{code}</MenuItem>
          ))}
        </TextField>
        <TextField size="small" select label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All categories</MenuItem>
          {(categories.data ?? []).filter((row) => row.is_active).map((row) => (
            <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>
          ))}
        </TextField>
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        <Button component={Link} href={eventAdminHref(site.id, "/new")} variant="contained">Add New Event</Button>
      </Box>
      {listed.error ? <Alert severity="error">Could not load Events.</Alert> : null}
      {!listed.data && !listed.error ? <Typography role="status">Loading Events…</Typography> : null}
      {listed.data && rows.length === 0 ? <Typography color="text.secondary">No Events match these filters.</Typography> : null}
      {rows.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((event) => (
            <Box component="li" key={event.id} sx={{ borderBottom: 1, borderColor: "divider", pb: 1.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>{event.title || "Untitled Event"}</Typography>
              <Typography variant="body2" color="text.secondary">
                {event.status} · {event.lifecycle} · {event.starts_at ? new Date(event.starts_at).toLocaleString() : "No start"} · /{event.slug || "—"}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button size="small" component={Link} href={`${eventAdminHref(site.id)}/${event.id}/edit`}>Edit</Button>
                <Button size="small" component={Link} href={`${eventAdminHref(site.id)}/${event.id}/preview`}>Preview</Button>
                <Button size="small" disabled={busyId === event.id} onClick={() => void runAction(event, "duplicate")}>Duplicate</Button>
                {event.status === "DRAFT" || event.status === "CANCELLED" ? (
                  <Button size="small" disabled={busyId === event.id} onClick={() => void runAction(event, "publish")}>Publish</Button>
                ) : null}
                {event.status === "PUBLISHED" ? (
                  <Button size="small" disabled={busyId === event.id} onClick={() => void runAction(event, "cancel")}>Cancel</Button>
                ) : null}
                {event.status !== "ARCHIVED" ? (
                  <Button size="small" disabled={busyId === event.id} onClick={() => void runAction(event, "archive")}>Archive</Button>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {count > 20 ? (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Typography variant="body2" sx={{ alignSelf: "center" }}>Page {page}</Typography>
          <Button disabled={page * 20 >= count} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </Box>
      ) : null}
    </Stack>
  );
}

export function SiteEventsNew() {
  const { site } = useSiteAdmin();
  return <SiteEventEditorPage siteId={site.id} mode="create" />;
}

export { SiteEventEditorPage };
