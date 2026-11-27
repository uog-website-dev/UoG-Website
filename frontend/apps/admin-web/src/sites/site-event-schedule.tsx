"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { emptySessionInput } from "@uog/types";
import type { EventSessionInput, EventSessionRecord, SessionStatus, SessionType, SessionVisibility } from "@uog/types";
import { FormErrorSummary, fieldErrorsFrom, useToast } from "@uog/ui";
import {
  createEventSession,
  duplicateEventSession,
  listEventSessions,
  removeEventSession,
  reorderEventSessions,
  updateEventSession,
} from "@/app/sites/event-session-actions";

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

function sessionEtag(session: EventSessionRecord): string {
  return `"site-event-session-${session.event}-${session.id}-v${session.version}"`;
}

type EventSessionListConflicts = {
  room_conflicts: Array<Record<string, unknown>>;
  speaker_warnings: Array<Record<string, unknown>>;
};

export function SiteEventSchedule({
  siteId,
  eventId,
  eventEtag,
  onEventEtagChange,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  eventEtag: string | null;
  onEventEtagChange?: (etag: string | null) => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<EventSessionRecord[]>([]);
  const [conflicts, setConflicts] = useState<EventSessionListConflicts>({ room_conflicts: [], speaker_warnings: [] });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventSessionInput>(emptySessionInput());
  const [etags, setEtags] = useState<Record<string, string>>({});

  async function reload(nextSearch = search) {
    setBusy(true);
    setError(null);
    const result = await listEventSessions(siteId, eventId, { search: nextSearch || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data.results);
    setConflicts(result.data.conflicts);
    setEtags(Object.fromEntries(result.data.results.map((row) => [row.id, sessionEtag(row)])));
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, eventId]);

  const grouped = useMemo(() => {
    const days = new Map<string, EventSessionRecord[]>();
    for (const row of rows) {
      const key = row.day_date || "unscheduled";
      const list = days.get(key) ?? [];
      list.push(row);
      days.set(key, list);
    }
    return [...days.entries()];
  }, [rows]);

  const fields = fieldErrorsFrom(error);

  function startCreate() {
    setEditingId("new");
    setDraft(emptySessionInput());
    setError(null);
  }

  function startEdit(row: EventSessionRecord) {
    setEditingId(row.id);
    setDraft({
      title: row.title,
      description: row.description,
      session_type: row.session_type,
      venue_room: row.venue_room,
      track: row.track,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      visibility: row.visibility,
      status: row.status,
      public_notes: row.public_notes,
      speaker_labels: row.speaker_labels,
    });
    setError(null);
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    const payload: EventSessionInput = {
      ...draft,
      speaker_labels: Array.isArray(draft.speaker_labels)
        ? draft.speaker_labels
        : String(draft.speaker_labels ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
    };
    const result = editingId === "new"
      ? await createEventSession(siteId, eventId, payload)
      : await updateEventSession(siteId, eventId, editingId!, etags[editingId!] ?? "", payload);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(editingId === "new" ? "Session added." : "Session updated.");
    setEditingId(null);
    await reload();
  }

  async function onDuplicate(row: EventSessionRecord) {
    setBusy(true);
    const result = await duplicateEventSession(siteId, eventId, row.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Session duplicated.");
    await reload();
  }

  async function onRemove(row: EventSessionRecord) {
    setBusy(true);
    const result = await removeEventSession(siteId, eventId, row.id, etags[row.id] ?? sessionEtag(row));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Session removed.");
    await reload();
  }

  async function move(row: EventSessionRecord, direction: -1 | 1) {
    const index = rows.findIndex((item) => item.id === row.id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= rows.length || !eventEtag) return;
    const order = rows.map((item) => item.id);
    [order[index], order[swap]] = [order[swap], order[index]];
    setBusy(true);
    const result = await reorderEventSessions(siteId, eventId, eventEtag, order);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data.data.results);
    setConflicts(result.data.data.conflicts);
    setEtags(Object.fromEntries(result.data.data.results.map((item) => [item.id, sessionEtag(item)])));
    onEventEtagChange?.(result.data.etag);
  }

  const set = <K extends keyof EventSessionInput>(key: K, value: EventSessionInput[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  return (
    <Box component="section" aria-labelledby="event-schedule" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-schedule" variant="h6" component="h2">Schedule &amp; Sessions</Typography>
      <Typography variant="body2" color="text.secondary">
        Add sessions across Event days. Parallel rooms are allowed; same-room overlaps warn and can block publish.
      </Typography>
      {conflicts.room_conflicts?.length ? (
        <Alert severity="warning">
          {conflicts.room_conflicts.map((item) => String(item.message ?? "Room conflict")).join(" ")}
        </Alert>
      ) : null}
      {conflicts.speaker_warnings?.length ? (
        <Alert severity="info">
          {conflicts.speaker_warnings.map((item) => String(item.message ?? "Speaker warning")).join(" ")}
        </Alert>
      ) : null}
      {error ? <FormErrorSummary error={error} /> : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <TextField
          label="Search sessions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={busy}
          size="small"
          sx={{ minWidth: 240 }}
        />
        <Button variant="outlined" disabled={busy} onClick={() => void reload(search)}>Search</Button>
        {!readOnly ? <Button variant="contained" disabled={busy} onClick={startCreate}>Add session</Button> : null}
      </Stack>

      {editingId ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
          <Typography variant="subtitle1">{editingId === "new" ? "New session" : "Edit session"}</Typography>
          <TextField label="Title" value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.title)} helperText={fields.title?.[0]} fullWidth />
          <TextField label="Description" value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} disabled={busy || readOnly} multiline minRows={3} fullWidth helperText={fields.description?.[0] ?? "HTML is sanitized on save"} />
          <TextField select label="Type" value={draft.session_type ?? "OTHER"} onChange={(e) => set("session_type", e.target.value as SessionType)} disabled={busy || readOnly} fullWidth>
            {(["KEYNOTE", "PANEL", "WORKSHOP", "BREAK", "OTHER"] as SessionType[]).map((value) => (
              <MenuItem key={value} value={value}>{value}</MenuItem>
            ))}
          </TextField>
          <TextField label="Starts" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(draft.starts_at)} onChange={(e) => set("starts_at", fromLocalInput(e.target.value))} disabled={busy || readOnly} error={Boolean(fields.starts_at)} helperText={fields.starts_at?.[0]} fullWidth />
          <TextField label="Ends" type="datetime-local" InputLabelProps={{ shrink: true }} value={toLocalInput(draft.ends_at)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value))} disabled={busy || readOnly} error={Boolean(fields.ends_at)} helperText={fields.ends_at?.[0]} fullWidth />
          <TextField label="Room / venue" value={draft.venue_room ?? ""} onChange={(e) => set("venue_room", e.target.value)} disabled={busy || readOnly} fullWidth />
          <TextField label="Track" value={draft.track ?? ""} onChange={(e) => set("track", e.target.value)} disabled={busy || readOnly} fullWidth />
          <TextField select label="Visibility" value={draft.visibility ?? "PUBLIC"} onChange={(e) => set("visibility", e.target.value as SessionVisibility)} disabled={busy || readOnly} fullWidth>
            <MenuItem value="PUBLIC">Public</MenuItem>
            <MenuItem value="HIDDEN">Hidden</MenuItem>
          </TextField>
          <TextField select label="Status" value={draft.status ?? "SCHEDULED"} onChange={(e) => set("status", e.target.value as SessionStatus)} disabled={busy || readOnly} fullWidth>
            {(["SCHEDULED", "UPDATED", "CANCELLED", "COMPLETED"] as SessionStatus[]).map((value) => (
              <MenuItem key={value} value={value}>{value}</MenuItem>
            ))}
          </TextField>
          <TextField label="Public notes" value={draft.public_notes ?? ""} onChange={(e) => set("public_notes", e.target.value)} disabled={busy || readOnly} fullWidth multiline minRows={2} />
          <TextField
            label="Speakers"
            value={Array.isArray(draft.speaker_labels) ? draft.speaker_labels.join(", ") : ""}
            onChange={(e) => set("speaker_labels", e.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
            disabled={busy || readOnly}
            helperText="Comma-separated labels for conflict warnings"
            fullWidth
          />
          {!readOnly ? (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" disabled={busy} onClick={() => void saveDraft()}>Save session</Button>
              <Button disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button>
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {grouped.length === 0 && !busy ? (
        <Typography color="text.secondary">No sessions yet.</Typography>
      ) : null}
      {grouped.map(([day, sessions]) => (
        <Box key={day} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle1" component="h3">{day}</Typography>
          {sessions.map((row) => (
            <Box
              key={row.id}
              sx={{
                display: "grid",
                gap: 0.5,
                gridTemplateColumns: { xs: "1fr", md: "1fr auto" },
                alignItems: "start",
                py: 1,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box>
                <Typography fontWeight={600}>
                  {row.title}
                  {row.status === "CANCELLED" ? " (Cancelled)" : ""}
                  {row.visibility === "HIDDEN" ? " · Hidden" : ""}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(row.starts_at).toLocaleString()} – {new Date(row.ends_at).toLocaleString()}
                  {row.venue_room ? ` · ${row.venue_room}` : ""}
                  {row.track ? ` · ${row.track}` : ""}
                  {row.session_type ? ` · ${row.session_type}` : ""}
                </Typography>
              </Box>
              {!readOnly ? (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  <Button size="small" disabled={busy} onClick={() => startEdit(row)}>Edit</Button>
                  <Button size="small" disabled={busy} onClick={() => void onDuplicate(row)}>Duplicate</Button>
                  <Button size="small" disabled={busy || !eventEtag} onClick={() => void move(row, -1)}>Up</Button>
                  <Button size="small" disabled={busy || !eventEtag} onClick={() => void move(row, 1)}>Down</Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => void onRemove(row)}>Remove</Button>
                </Stack>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
