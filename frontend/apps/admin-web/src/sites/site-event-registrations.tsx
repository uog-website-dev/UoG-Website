"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import {
  actOnSiteEventParticipant,
  checkInSiteEventParticipant,
  createSiteEventParticipant,
  exportSiteEventParticipantsCsv,
  fetchSiteEventParticipantBadge,
  listSiteEventRegistrations,
  updateSiteEventParticipant,
  type EventRegistrationInventory,
  type EventRegistrationRow,
} from "@/app/sites/event-record-actions";

const CATEGORIES = ["PARTICIPANT", "SPEAKER", "VIP", "MODERATOR", "ORGANIZER"] as const;

function printBadge(badge: {
  event_title: string;
  participant_name: string;
  display_category: string;
  check_in_token: string;
}) {
  const html = `<!doctype html><html><head><title>Badge</title>
<style>
  body{font-family:Georgia,serif;margin:0;padding:2rem;background:#f3efe6}
  .badge{width:320px;border:2px solid #1f3a2e;padding:1.5rem;background:#fff}
  .event{font-size:0.85rem;letter-spacing:0.04em;text-transform:uppercase;color:#1f3a2e;margin:0 0 0.75rem}
  .name{font-size:1.6rem;margin:0 0 0.35rem;color:#111}
  .category{font-size:1rem;margin:0 0 1rem;color:#444}
  .token{font-family:ui-monospace,monospace;font-size:0.8rem;word-break:break-all;color:#222}
</style></head><body>
  <article class="badge">
    <p class="event">${escapeHtml(badge.event_title)}</p>
    <h1 class="name">${escapeHtml(badge.participant_name)}</h1>
    <p class="category">${escapeHtml(badge.display_category)}</p>
    <p class="token">${escapeHtml(badge.check_in_token)}</p>
  </article>
  <script>window.onload=function(){window.print()}</script>
</body></html>`;
  const win = window.open("", "_blank", "noopener,noreferrer,width=420,height=560");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function SiteEventRegistrations({
  siteId,
  eventId,
}: {
  siteId: number;
  eventId: string;
}) {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [inventory, setInventory] = useState<EventRegistrationInventory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    participant_name: "",
    email: "",
    organization: "",
    display_category: "PARTICIPANT",
    mode: "invite" as "invite" | "register",
  });

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await listSiteEventRegistrations(siteId, eventId, {
      status: status || undefined,
      category: category || undefined,
      search: search || undefined,
      page,
      page_size: 20,
    });
    setBusy(false);
    if (!result.ok) {
      setError("Participants could not be loaded.");
      setInventory(null);
      return;
    }
    setInventory(result.data);
  }, [siteId, eventId, status, category, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    setBusy(true);
    setError("");
    const result = await createSiteEventParticipant(siteId, eventId, {
      ...form,
      request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Participant could not be added.");
      return;
    }
    setForm({
      participant_name: "",
      email: "",
      organization: "",
      display_category: "PARTICIPANT",
      mode: "invite",
    });
    await load();
  }

  async function onCategoryChange(row: EventRegistrationRow, next: string) {
    setBusy(true);
    const result = await updateSiteEventParticipant(siteId, eventId, row.id, {
      display_category: next,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Category could not be updated.");
      return;
    }
    await load();
  }

  async function onAction(row: EventRegistrationRow, action: "confirm" | "cancel" | "delete") {
    setBusy(true);
    const result = await actOnSiteEventParticipant(siteId, eventId, row.id, action);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Action failed.");
      return;
    }
    await load();
  }

  async function onBadge(row: EventRegistrationRow) {
    const first = await fetchSiteEventParticipantBadge(siteId, eventId, row.id);
    if (!first.ok) {
      setError(first.error.message || "Badge could not be loaded.");
      return;
    }
    const token = first.data.check_in_token;
    const second = await fetchSiteEventParticipantBadge(siteId, eventId, row.id);
    if (second.ok && second.data.check_in_token !== token) {
      setError("Badge token changed unexpectedly.");
      return;
    }
    printBadge(first.data);
  }

  async function onExport() {
    setBusy(true);
    const result = await exportSiteEventParticipantsCsv(siteId, eventId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Export failed.");
      return;
    }
    const blob = new Blob([result.data.content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onCheckIn(row: EventRegistrationRow, override = false) {
    setBusy(true);
    const result = await checkInSiteEventParticipant(siteId, eventId, row.id, { override });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Check-in failed.");
      return;
    }
    if (result.data.replayed) {
      setError("");
    }
    await load();
  }

  const totalPages = inventory ? Math.max(1, Math.ceil(inventory.count / inventory.page_size)) : 1;

  return (
    <Box component="section" aria-labelledby="event-participants" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-participants" variant="h6" component="h2">
        Participants
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Invite or register attendees without creating CMS accounts. Display categories are independent of session speaker roles.
        Soft-deleted records are retained for audit; hard purge is an operations task.
      </Typography>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" } }}>
        <TextField
          size="small"
          label="Display name"
          value={form.participant_name}
          onChange={(event) => setForm((prev) => ({ ...prev, participant_name: event.target.value }))}
        />
        <TextField
          size="small"
          label="Email"
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
        />
        <TextField
          size="small"
          label="Organization"
          value={form.organization}
          onChange={(event) => setForm((prev) => ({ ...prev, organization: event.target.value }))}
        />
        <TextField
          select
          size="small"
          label="Category"
          value={form.display_category}
          onChange={(event) => setForm((prev) => ({ ...prev, display_category: event.target.value }))}
        >
          {CATEGORIES.map((item) => (
            <MenuItem key={item} value={item}>{item}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Mode"
          value={form.mode}
          onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value as "invite" | "register" }))}
        >
          <MenuItem value="invite">Invite</MenuItem>
          <MenuItem value="register">Register now</MenuItem>
        </TextField>
        <Button variant="contained" onClick={() => void onCreate()} disabled={busy || !form.participant_name || !form.email}>
          Add participant
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="INVITED">Invited</MenuItem>
          <MenuItem value="CONFIRMED">Confirmed</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
          <MenuItem value="CANCELLED">Cancelled</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Category"
          value={category}
          onChange={(event) => {
            setPage(1);
            setCategory(event.target.value);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {CATEGORIES.map((item) => (
            <MenuItem key={item} value={item}>{item}</MenuItem>
          ))}
        </TextField>
        <Button onClick={() => void load()} disabled={busy}>Refresh</Button>
        <Button onClick={() => void onExport()} disabled={busy}>Export CSV</Button>
      </Box>

      {inventory?.summary ? (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={`State: ${inventory.summary.state}`} />
          <Chip label={`Confirmed seats: ${inventory.summary.confirmed}`} />
          <Chip label={`Invited: ${inventory.summary.invited}`} />
          <Chip label={`Waitlisted: ${inventory.summary.waitlisted}`} />
          <Chip label={`Cancelled: ${inventory.summary.cancelled}`} />
          <Chip
            label={
              inventory.summary.capacity == null
                ? "Capacity: unlimited"
                : `Remaining: ${inventory.summary.seats_remaining ?? 0} / ${inventory.summary.capacity}`
            }
          />
        </Box>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {busy && !inventory ? <Typography role="status">Loading participants…</Typography> : null}
      {inventory && inventory.results.length === 0 ? (
        <Typography color="text.secondary">No participants match this filter.</Typography>
      ) : null}

      {inventory && inventory.results.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
          {inventory.results.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1.25, display: "flex", flexDirection: "column", gap: 1 }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "baseline", justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {row.participant_name} · {row.email}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.source} · {new Date(row.created_at).toLocaleString()}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {row.status}
                {row.waitlist_position ? ` · waitlist #${row.waitlist_position}` : ""}
                {row.organization ? ` · ${row.organization}` : ""}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                <TextField
                  select
                  size="small"
                  label="Category"
                  value={row.display_category}
                  onChange={(event) => void onCategoryChange(row, event.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  {CATEGORIES.map((item) => (
                    <MenuItem key={item} value={item}>{item}</MenuItem>
                  ))}
                </TextField>
                {row.status !== "CONFIRMED" && row.status !== "CANCELLED" ? (
                  <Button size="small" onClick={() => void onAction(row, "confirm")} disabled={busy}>Confirm</Button>
                ) : null}
                {row.status !== "CANCELLED" ? (
                  <Button size="small" onClick={() => void onAction(row, "cancel")} disabled={busy}>Cancel</Button>
                ) : null}
                <Button size="small" onClick={() => void onBadge(row)} disabled={busy}>Print badge</Button>
                {row.status === "CONFIRMED" || row.status === "INVITED" ? (
                  <Button size="small" variant="contained" onClick={() => void onCheckIn(row)} disabled={busy}>
                    Check in
                  </Button>
                ) : null}
                {row.status === "CANCELLED" ? (
                  <Button size="small" color="warning" onClick={() => void onCheckIn(row, true)} disabled={busy}>
                    Override check-in
                  </Button>
                ) : null}
                <Button size="small" color="warning" onClick={() => void onAction(row, "delete")} disabled={busy}>
                  Soft delete
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {inventory && inventory.count > inventory.page_size ? (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button disabled={page <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Previous
          </Button>
          <Typography variant="body2">Page {page} of {totalPages}</Typography>
          <Button disabled={page >= totalPages || busy} onClick={() => setPage((value) => value + 1)}>
            Next
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
