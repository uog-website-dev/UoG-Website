"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { emptyPersonInput } from "@uog/types";
import type { EventPersonInput, EventPersonRecord, PersonVisibility, SessionPersonRole } from "@uog/types";
import { FormErrorSummary, fieldErrorsFrom, useToast } from "@uog/ui";
import {
  assignSessionPerson,
  createEventPerson,
  listEventPeople,
  listSessionPeople,
  removeEventPerson,
  unassignSessionPerson,
  updateEventPerson,
} from "@/app/sites/event-person-actions";
import { listEventSessions } from "@/app/sites/event-session-actions";

function personEtag(person: EventPersonRecord): string {
  return `"site-event-person-${person.event}-${person.id}-v${person.version}"`;
}

export function SiteEventPeople({
  siteId,
  eventId,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [people, setPeople] = useState<EventPersonRecord[]>([]);
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventPersonInput>(emptyPersonInput());
  const [etags, setEtags] = useState<Record<string, string>>({});
  const [assignPersonId, setAssignPersonId] = useState("");
  const [assignSessionId, setAssignSessionId] = useState("");
  const [assignRole, setAssignRole] = useState<SessionPersonRole>("SPEAKER");
  const [sessionAssignments, setSessionAssignments] = useState<Record<string, string>>({});

  async function reload(nextSearch = search) {
    setBusy(true);
    setError(null);
    const [peopleResult, sessionsResult] = await Promise.all([
      listEventPeople(siteId, eventId, nextSearch),
      listEventSessions(siteId, eventId),
    ]);
    setBusy(false);
    if (!peopleResult.ok) {
      setError(peopleResult.error);
      return;
    }
    if (!sessionsResult.ok) {
      setError(sessionsResult.error);
      return;
    }
    setPeople(peopleResult.data.results);
    setEtags(Object.fromEntries(peopleResult.data.results.map((row) => [row.id, personEtag(row)])));
    setSessions(sessionsResult.data.results.map((row) => ({ id: row.id, title: row.title })));
    const assignmentLabels: Record<string, string> = {};
    await Promise.all(
      sessionsResult.data.results.map(async (session) => {
        const assigned = await listSessionPeople(siteId, eventId, session.id);
        if (!assigned.ok) return;
        assignmentLabels[session.id] = assigned.data.results
          .map((row) => `${row.person_summary?.display_name ?? row.person} (${row.role})`)
          .join(", ");
      }),
    );
    setSessionAssignments(assignmentLabels);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, eventId]);

  const fields = fieldErrorsFrom(error);
  const set = <K extends keyof EventPersonInput>(key: K, value: EventPersonInput[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  function startCreate() {
    setEditingId("new");
    setDraft(emptyPersonInput());
    setError(null);
  }

  function startEdit(row: EventPersonRecord) {
    setEditingId(row.id);
    setDraft({
      display_name: row.display_name,
      affiliation: row.affiliation,
      biography: row.biography,
      profile_photo: row.profile_photo,
      public_links: row.public_links,
      visibility: row.visibility,
      private_email: row.private_email,
      private_phone: row.private_phone,
    });
    setError(null);
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    const links = Array.isArray(draft.public_links)
      ? draft.public_links
      : String(draft.public_links ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [label, url] = line.split("|").map((part) => part.trim());
            return { label: label || "Link", url: url || label };
          });
    const payload: EventPersonInput = { ...draft, public_links: links };
    const result = editingId === "new"
      ? await createEventPerson(siteId, eventId, payload)
      : await updateEventPerson(siteId, eventId, editingId!, etags[editingId!] ?? "", payload);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(editingId === "new" ? "Speaker added." : "Speaker updated.");
    setEditingId(null);
    await reload();
  }

  async function onRemove(row: EventPersonRecord) {
    setBusy(true);
    const result = await removeEventPerson(siteId, eventId, row.id, etags[row.id] ?? personEtag(row));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Speaker profile removed.");
    await reload();
  }

  async function onAssign() {
    if (!assignPersonId || !assignSessionId) return;
    setBusy(true);
    const result = await assignSessionPerson(siteId, eventId, assignSessionId, {
      person: assignPersonId,
      role: assignRole,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Assignment saved.");
    await reload();
  }

  async function onUnassign(sessionId: string) {
    setBusy(true);
    const listed = await listSessionPeople(siteId, eventId, sessionId);
    if (!listed.ok) {
      setBusy(false);
      setError(listed.error);
      return;
    }
    for (const row of listed.data.results) {
      const removed = await unassignSessionPerson(siteId, eventId, sessionId, row.id);
      if (!removed.ok) {
        setBusy(false);
        setError(removed.error);
        return;
      }
    }
    setBusy(false);
    toast.success("Session assignments cleared.");
    await reload();
  }

  return (
    <Box component="section" aria-labelledby="event-people" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-people" variant="h6" component="h2">Speakers &amp; Organizers</Typography>
      <Typography variant="body2" color="text.secondary">
        Maintain Event-scoped speaker profiles and assign them to sessions. Profiles are independent from registration accounts.
      </Typography>
      {error ? <FormErrorSummary error={error} /> : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <TextField label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} disabled={busy} size="small" sx={{ minWidth: 240 }} />
        <Button variant="outlined" disabled={busy} onClick={() => void reload(search)}>Search</Button>
        {!readOnly ? <Button variant="contained" disabled={busy} onClick={startCreate}>Add person</Button> : null}
      </Stack>

      {editingId ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
          <Typography variant="subtitle1">{editingId === "new" ? "New person" : "Edit person"}</Typography>
          <TextField label="Display name" value={draft.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} disabled={busy || readOnly} error={Boolean(fields.display_name)} helperText={fields.display_name?.[0]} fullWidth />
          <TextField label="Affiliation" value={draft.affiliation ?? ""} onChange={(e) => set("affiliation", e.target.value)} disabled={busy || readOnly} fullWidth />
          <TextField label="Biography" value={draft.biography ?? ""} onChange={(e) => set("biography", e.target.value)} disabled={busy || readOnly} multiline minRows={3} fullWidth helperText={fields.biography?.[0] ?? "HTML is sanitized on save"} />
          <TextField label="Profile photo asset ID" value={draft.profile_photo ?? ""} onChange={(e) => set("profile_photo", e.target.value || null)} disabled={busy || readOnly} fullWidth helperText={fields.profile_photo?.[0] ?? "Ready Site Media Library image UUID"} />
          <TextField
            label="Public links"
            value={(draft.public_links ?? []).map((link) => `${link.label}|${link.url}`).join("\n")}
            onChange={(e) =>
              set(
                "public_links",
                e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const [label, url] = line.split("|").map((part) => part.trim());
                    return { label: label || "Link", url: url || label };
                  }),
              )
            }
            disabled={busy || readOnly}
            fullWidth
            multiline
            minRows={2}
            helperText={fields.public_links?.[0] ?? "One per line as Label|https://example.com"}
          />
          <TextField select label="Visibility" value={draft.visibility ?? "PUBLIC"} onChange={(e) => set("visibility", e.target.value as PersonVisibility)} disabled={busy || readOnly} fullWidth>
            <MenuItem value="PUBLIC">Public</MenuItem>
            <MenuItem value="HIDDEN">Hidden</MenuItem>
          </TextField>
          <TextField label="Private email" value={draft.private_email ?? ""} onChange={(e) => set("private_email", e.target.value)} disabled={busy || readOnly} fullWidth helperText="Admin only — never exposed publicly" />
          <TextField label="Private phone" value={draft.private_phone ?? ""} onChange={(e) => set("private_phone", e.target.value)} disabled={busy || readOnly} fullWidth />
          {!readOnly ? (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" disabled={busy} onClick={() => void saveDraft()}>Save person</Button>
              <Button disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button>
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {people.length === 0 && !busy ? <Typography color="text.secondary">No speakers yet.</Typography> : null}
      {people.map((row) => (
        <Box key={row.id} sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "1fr auto" }, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <Box>
            <Typography fontWeight={600}>
              {row.display_name}
              {row.visibility === "HIDDEN" ? " · Hidden" : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {row.affiliation || "No affiliation"}
              {row.private_email ? ` · private ${row.private_email}` : ""}
            </Typography>
          </Box>
          {!readOnly ? (
            <Stack direction="row" spacing={0.5}>
              <Button size="small" disabled={busy} onClick={() => startEdit(row)}>Edit</Button>
              <Button size="small" color="error" disabled={busy} onClick={() => void onRemove(row)}>Remove</Button>
            </Stack>
          ) : null}
        </Box>
      ))}

      {!readOnly && people.length > 0 && sessions.length > 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
          <Typography variant="subtitle1">Assign to session</Typography>
          <TextField select label="Person" value={assignPersonId} onChange={(e) => setAssignPersonId(e.target.value)} disabled={busy} fullWidth>
            <MenuItem value="">Select person</MenuItem>
            {people.map((row) => <MenuItem key={row.id} value={row.id}>{row.display_name}</MenuItem>)}
          </TextField>
          <TextField select label="Session" value={assignSessionId} onChange={(e) => setAssignSessionId(e.target.value)} disabled={busy} fullWidth>
            <MenuItem value="">Select session</MenuItem>
            {sessions.map((row) => <MenuItem key={row.id} value={row.id}>{row.title}</MenuItem>)}
          </TextField>
          <TextField select label="Role" value={assignRole} onChange={(e) => setAssignRole(e.target.value as SessionPersonRole)} disabled={busy} fullWidth>
            {(["SPEAKER", "MODERATOR", "PANELIST", "ORGANIZER"] as SessionPersonRole[]).map((role) => (
              <MenuItem key={role} value={role}>{role}</MenuItem>
            ))}
          </TextField>
          <Button variant="contained" disabled={busy || !assignPersonId || !assignSessionId} onClick={() => void onAssign()}>
            Assign
          </Button>
        </Box>
      ) : null}

      {sessions.length > 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle1">Session mapping</Typography>
          {sessions.map((session) => (
            <Box key={session.id} sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "1fr auto" }, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
              <Box>
                <Typography fontWeight={600}>{session.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {sessionAssignments[session.id] || "No assignments"}
                </Typography>
              </Box>
              {!readOnly && sessionAssignments[session.id] ? (
                <Button size="small" disabled={busy} onClick={() => void onUnassign(session.id)}>Clear</Button>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : (
        <Alert severity="info">Add sessions first to map speakers and moderators.</Alert>
      )}
    </Box>
  );
}
