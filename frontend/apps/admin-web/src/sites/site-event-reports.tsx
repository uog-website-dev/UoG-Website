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
  exportSiteEventReportCsv,
  fetchSiteEventReport,
  scanSiteEventCheckIn,
  type EventReportPayload,
} from "@/app/sites/event-record-actions";

const CATEGORIES = ["PARTICIPANT", "SPEAKER", "VIP", "MODERATOR", "ORGANIZER"] as const;

export function SiteEventReports({
  siteId,
  eventId,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  readOnly?: boolean;
}) {
  const [report, setReport] = useState<EventReportPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [attended, setAttended] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scanToken, setScanToken] = useState("");
  const [scanNote, setScanNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const result = await fetchSiteEventReport(siteId, eventId, {
      status: status || undefined,
      category: category || undefined,
      attended: attended || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Report could not be loaded.");
      setReport(null);
      return;
    }
    setReport(result.data);
  }, [siteId, eventId, status, category, attended, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onExport() {
    setBusy(true);
    const result = await exportSiteEventReportCsv(siteId, eventId, {
      status: status || undefined,
      category: category || undefined,
      attended: attended || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Report export failed.");
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

  async function onScan(override = false) {
    setBusy(true);
    setError("");
    const result = await scanSiteEventCheckIn(siteId, eventId, scanToken.trim(), {
      override,
      notes: scanNote,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Check-in scan failed.");
      return;
    }
    setScanNote(result.data.replayed ? "Already checked in (idempotent replay)." : "Checked in.");
    setScanToken("");
    await load();
  }

  const metrics = report?.metrics;

  return (
    <Box component="section" aria-labelledby="event-reports" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-reports" variant="h6" component="h2">
        Event Reports & Attendance
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Registration and attendance metrics are private to this Site. Offline check-in sync is out of scope.
        QR scans use the signed badge payload or opaque check-in token; repeats do not inflate totals.
      </Typography>

      {!readOnly ? (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr auto auto" } }}>
          <TextField
            size="small"
            label="Scan QR / check-in token"
            value={scanToken}
            onChange={(event) => setScanToken(event.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Notes"
            value={scanNote}
            onChange={(event) => setScanNote(event.target.value)}
          />
          <Button variant="contained" disabled={busy || !scanToken.trim()} onClick={() => void onScan(false)}>
            Check in
          </Button>
          <Button disabled={busy || !scanToken.trim()} onClick={() => void onScan(true)}>
            Override cancelled
          </Button>
        </Box>
      ) : null}

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="CONFIRMED">Confirmed</MenuItem>
          <MenuItem value="INVITED">Invited</MenuItem>
          <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
          <MenuItem value="CANCELLED">Cancelled</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {CATEGORIES.map((item) => (
            <MenuItem key={item} value={item}>{item}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Attended"
          value={attended}
          onChange={(event) => setAttended(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="true">Attended</MenuItem>
          <MenuItem value="false">Not attended</MenuItem>
        </TextField>
        <TextField
          size="small"
          type="date"
          label="From"
          InputLabelProps={{ shrink: true }}
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          InputLabelProps={{ shrink: true }}
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <Button onClick={() => void load()} disabled={busy}>Refresh</Button>
        <Button onClick={() => void onExport()} disabled={busy || readOnly}>Export report CSV</Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {busy && !report ? <Typography role="status">Loading report…</Typography> : null}

      {metrics ? (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }} aria-label="Event outcome metrics">
          <Chip label={`Registrations: ${metrics.registrations}`} />
          <Chip label={`Confirmed: ${metrics.confirmed}`} />
          <Chip label={`Waitlisted: ${metrics.waitlisted}`} />
          <Chip label={`Cancelled: ${metrics.cancelled}`} />
          <Chip label={`Attended: ${metrics.attended}`} />
          <Chip
            label={
              metrics.capacity == null
                ? "Capacity: unlimited"
                : `Utilization: ${Math.round((metrics.capacity_utilization || 0) * 100)}% (${metrics.attended}/${metrics.capacity})`
            }
          />
        </Box>
      ) : null}

      {report?.categories?.length ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.75 }}>
          {report.categories.map((row) => (
            <Typography component="li" key={row.category} variant="body2">
              {row.category}: {row.registrations} registered · {row.confirmed} confirmed · {row.attended} attended
            </Typography>
          ))}
        </Box>
      ) : null}

      {report ? (
        <Typography variant="body2" color="text.secondary">
          Filtered rows: {report.filtered_count} (showing up to {report.results.length})
        </Typography>
      ) : null}
    </Box>
  );
}
