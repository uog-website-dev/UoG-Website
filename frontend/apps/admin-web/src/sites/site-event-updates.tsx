"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import {
  actOnEventUpdate,
  createEventUpdate,
  listEventUpdates,
  updateEventUpdate,
  type EventUpdateRow,
  type UpdateSeverity,
} from "@/app/sites/event-update-actions";

const SEVERITIES: UpdateSeverity[] = ["INFO", "IMPORTANT", "URGENT"];

export function SiteEventUpdates({
  siteId,
  eventId,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<EventUpdateRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    body: "",
    severity: "INFO" as UpdateSeverity,
    pinned: false,
  });

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await listEventUpdates(siteId, eventId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Updates could not be loaded.");
      setRows([]);
      return;
    }
    setRows(result.data);
  }, [siteId, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    if (!form.title.trim()) return;
    setBusy(true);
    const result = await createEventUpdate(siteId, eventId, form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Update could not be created.");
      return;
    }
    setForm({ title: "", body: "", severity: "INFO", pinned: false });
    await load();
  }

  async function onSave(row: EventUpdateRow, patch: Partial<EventUpdateRow>) {
    setBusy(true);
    const result = await updateEventUpdate(siteId, eventId, row.id, {
      ...patch,
      version: row.version,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Update could not be saved.");
      return;
    }
    await load();
  }

  async function onAction(row: EventUpdateRow, action: "publish" | "unpublish") {
    setBusy(true);
    const result = await actOnEventUpdate(siteId, eventId, row.id, action, row.version);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Action failed.");
      return;
    }
    await load();
  }

  return (
    <Box component="section" aria-labelledby="event-updates" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-updates" variant="h6" component="h2">
        Event Updates
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Publish schedule, venue, and resource notices without republishing the Event. Drafts stay private.
        This panel does not send email, SMS, or push notifications.
      </Typography>

      {!readOnly ? (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <TextField
            size="small"
            label="Title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            fullWidth
          />
          <TextField
            select
            size="small"
            label="Severity"
            value={form.severity}
            onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value as UpdateSeverity }))}
          >
            {SEVERITIES.map((item) => (
              <MenuItem key={item} value={item}>{item}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Body"
            value={form.body}
            onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
            sx={{ gridColumn: { md: "1 / -1" } }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={form.pinned}
                onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
              />
            }
            label="Pin / high-priority on Overview"
          />
          <Button variant="contained" disabled={busy || !form.title.trim()} onClick={() => void onCreate()}>
            Save draft update
          </Button>
        </Box>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {busy && rows.length === 0 ? <Typography role="status">Loading updates…</Typography> : null}
      {rows.length === 0 ? (
        <Typography color="text.secondary">No updates yet.</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {row.title}
                {row.pinned ? " · pinned" : ""}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {row.status} · {row.severity}
                {row.published_at ? ` · published ${new Date(row.published_at).toLocaleString()}` : ""}
              </Typography>
              {!readOnly ? (
                <>
                  <TextField
                    size="small"
                    label="Title"
                    defaultValue={row.title}
                    onBlur={(event) => {
                      if (event.target.value !== row.title) void onSave(row, { title: event.target.value });
                    }}
                  />
                  <TextField
                    size="small"
                    label="Body"
                    defaultValue={row.body}
                    multiline
                    minRows={2}
                    onBlur={(event) => {
                      if (event.target.value !== row.body) void onSave(row, { body: event.target.value });
                    }}
                  />
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    <TextField
                      select
                      size="small"
                      label="Severity"
                      value={row.severity}
                      onChange={(event) => void onSave(row, { severity: event.target.value as UpdateSeverity })}
                      sx={{ minWidth: 160 }}
                    >
                      {SEVERITIES.map((item) => (
                        <MenuItem key={item} value={item}>{item}</MenuItem>
                      ))}
                    </TextField>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={row.pinned}
                          onChange={(event) => void onSave(row, { pinned: event.target.checked })}
                        />
                      }
                      label="Pinned"
                    />
                    {row.status === "PUBLISHED" ? (
                      <Button size="small" disabled={busy} onClick={() => void onAction(row, "unpublish")}>
                        Unpublish
                      </Button>
                    ) : (
                      <Button size="small" variant="contained" disabled={busy} onClick={() => void onAction(row, "publish")}>
                        Publish
                      </Button>
                    )}
                  </Box>
                </>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
