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
  listSiteEventRegistrations,
  type EventRegistrationInventory,
} from "@/app/sites/event-record-actions";

export function SiteEventRegistrations({
  siteId,
  eventId,
}: {
  siteId: number;
  eventId: string;
}) {
  const [status, setStatus] = useState("");
  const [inventory, setInventory] = useState<EventRegistrationInventory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await listSiteEventRegistrations(siteId, eventId, status || undefined);
    setBusy(false);
    if (!result.ok) {
      setError("Registrations could not be loaded.");
      setInventory(null);
      return;
    }
    setInventory(result.data);
  }, [siteId, eventId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box component="section" aria-labelledby="event-registrations" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-registrations" variant="h6" component="h2">
        Registrations
      </Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          select
          size="small"
          label="Status filter"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="CONFIRMED">Confirmed</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
          <MenuItem value="CANCELLED">Cancelled</MenuItem>
        </TextField>
        <Button onClick={() => void load()} disabled={busy}>Refresh</Button>
      </Box>
      {inventory?.summary ? (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={`State: ${inventory.summary.state}`} />
          <Chip label={`Confirmed: ${inventory.summary.confirmed}`} />
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
      {busy && !inventory ? <Typography role="status">Loading registrations…</Typography> : null}
      {inventory && inventory.results.length === 0 ? (
        <Typography color="text.secondary">No registrations match this filter.</Typography>
      ) : null}
      {inventory && inventory.results.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
          {inventory.results.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1, display: "flex", flexDirection: "column", gap: 0.25 }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {row.participant_name} · {row.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {row.status}
                {row.waitlist_position ? ` · waitlist #${row.waitlist_position}` : ""}
                {row.organization ? ` · ${row.organization}` : ""}
                {row.phone ? ` · ${row.phone}` : ""}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Registered {new Date(row.created_at).toLocaleString()} · notice {row.notification_status}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
