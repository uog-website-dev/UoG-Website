"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import {
  createEventResource,
  listEventResources,
  listSelectableDocuments,
  removeEventResource,
  setEventResourceVisibility,
  type EventResourceRow,
  type ResourceVisibility,
} from "@/app/sites/event-resource-actions";
import type { SiteDocument } from "@/app/sites/document-actions";
import { listEventSessions } from "@/app/sites/event-session-actions";

const CATEGORIES = ["BROCHURE", "SLIDES", "AGENDA", "HANDOUT", "OTHER"] as const;
const VISIBILITIES: ResourceVisibility[] = ["DRAFT", "PUBLIC", "REGISTERED_ONLY"];

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SiteEventResources({
  siteId,
  eventId,
  readOnly = false,
}: {
  siteId: number;
  eventId: string;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<EventResourceRow[]>([]);
  const [documents, setDocuments] = useState<SiteDocument[]>([]);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    document: "",
    title: "",
    category: "BROCHURE",
    session: "",
    visibility: "DRAFT" as ResourceVisibility,
  });

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const [resources, docs, agenda] = await Promise.all([
      listEventResources(siteId, eventId),
      listSelectableDocuments(siteId),
      listEventSessions(siteId, eventId),
    ]);
    setBusy(false);
    if (!resources.ok) {
      setError(resources.error.message || "Resources could not be loaded.");
      setRows([]);
      return;
    }
    setRows(resources.data);
    if (docs.ok) setDocuments(docs.data);
    if (agenda.ok) {
      setSessions(agenda.data.results.map((row) => ({ id: row.id, title: row.title })));
    }
  }, [siteId, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    if (!form.document || !form.title) return;
    setBusy(true);
    const result = await createEventResource(siteId, eventId, {
      document: form.document,
      title: form.title,
      category: form.category,
      session: form.session || null,
      visibility: form.visibility,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Could not attach resource.");
      return;
    }
    setForm({ document: "", title: "", category: "BROCHURE", session: "", visibility: "DRAFT" });
    await load();
  }

  async function onVisibility(row: EventResourceRow, visibility: ResourceVisibility) {
    setBusy(true);
    const result = await setEventResourceVisibility(siteId, eventId, row.id, visibility);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Visibility could not be updated.");
      return;
    }
    await load();
  }

  async function onRemove(row: EventResourceRow) {
    setBusy(true);
    const result = await removeEventResource(siteId, eventId, row.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || "Association could not be removed.");
      return;
    }
    await load();
  }

  return (
    <Box component="section" aria-labelledby="event-resources" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography id="event-resources" variant="h6" component="h2">
        Resources & Downloads
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Attach Site-owned documents without duplicating files. Publish resources independently while the Event is in progress or completed.
        Removing an association keeps the canonical Document. Supported types: PDF, DOCX, XLSX, ZIP (READY after malware scan).
      </Typography>

      {!readOnly ? (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr 1fr" } }}>
          <TextField
            select
            size="small"
            label="Existing document"
            value={form.document}
            onChange={(event) => {
              const id = event.target.value;
              const doc = documents.find((row) => row.id === id);
              setForm((prev) => ({
                ...prev,
                document: id,
                title: prev.title || doc?.title || "",
              }));
            }}
          >
            <MenuItem value="">Select document</MenuItem>
            {documents.map((doc) => (
              <MenuItem key={doc.id} value={doc.id}>
                {doc.title} ({doc.original_filename || doc.file_type || "file"})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Display title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
          <TextField
            select
            size="small"
            label="Category"
            value={form.category}
            onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
          >
            {CATEGORIES.map((item) => (
              <MenuItem key={item} value={item}>{item}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Session (optional)"
            value={form.session}
            onChange={(event) => setForm((prev) => ({ ...prev, session: event.target.value }))}
          >
            <MenuItem value="">Event-level</MenuItem>
            {sessions.map((session) => (
              <MenuItem key={session.id} value={session.id}>{session.title}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Visibility"
            value={form.visibility}
            onChange={(event) => setForm((prev) => ({ ...prev, visibility: event.target.value as ResourceVisibility }))}
          >
            {VISIBILITIES.map((item) => (
              <MenuItem key={item} value={item}>{item}</MenuItem>
            ))}
          </TextField>
          <Button variant="contained" disabled={busy || !form.document || !form.title} onClick={() => void onCreate()}>
            Attach resource
          </Button>
        </Box>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {busy && rows.length === 0 ? <Typography role="status">Loading resources…</Typography> : null}
      {rows.length === 0 ? (
        <Typography color="text.secondary">No resources attached yet.</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
          {rows.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1.25, display: "flex", flexDirection: "column", gap: 1 }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {row.title}
                {row.session_title ? ` · ${row.session_title}` : " · Event-level"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {row.category} · {row.visibility} · {row.original_filename || "file"} · {formatSize(row.file_size)}
                {row.file_ready ? "" : " · file not ready"}
              </Typography>
              {!readOnly ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {VISIBILITIES.map((visibility) => (
                    <Button
                      key={visibility}
                      size="small"
                      variant={row.visibility === visibility ? "contained" : "outlined"}
                      disabled={busy || row.visibility === visibility}
                      onClick={() => void onVisibility(row, visibility)}
                    >
                      {visibility === "DRAFT" ? "Unpublish" : visibility === "PUBLIC" ? "Publish public" : "Registered only"}
                    </Button>
                  ))}
                  <Button size="small" color="warning" disabled={busy} onClick={() => void onRemove(row)}>
                    Remove association
                  </Button>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
