"use client";

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { publicFetchInit } from "@uog/ui";
import type { SiteEventRecord } from "@uog/types";

function newRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    const digit = char === "x" ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}

export function PublicEventRegistrationForm({ event }: { event: SiteEventRecord }) {
  const required = useMemo(
    () => event.registration_required_fields?.length
      ? event.registration_required_fields
      : ["participant_name", "email"],
    [event.registration_required_fields],
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    status: string;
    management_token: string;
    waitlist_position: number | null;
  } | null>(null);

  const state = event.registration_state || (event.accepts_registration ? "OPEN" : "CLOSED");
  if (!event.registration_required || state === "OFF") return null;

  if (event.status === "CANCELLED") {
    return <Alert severity="warning">Registration is unavailable because this Event was cancelled.</Alert>;
  }

  if (state === "CLOSED" || state === "FULL") {
    return (
      <Alert severity="info">
        {state === "FULL" ? "This Event is full." : "Registration is currently closed."}
        {event.registration_notice ? ` ${event.registration_notice}` : ""}
      </Alert>
    );
  }

  if (receipt) {
    return (
      <Alert severity="success">
        {receipt.status === "WAITLISTED"
          ? `You are on the waitlist${receipt.waitlist_position ? ` (position ${receipt.waitlist_position})` : ""}.`
          : "Your registration is confirmed."}
        {" "}Keep this cancellation code private: <strong>{receipt.management_token}</strong>
      </Alert>
    );
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/site-context/events/${encodeURIComponent(event.slug)}/registrations/`, {
        ...publicFetchInit(),
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          request_id: newRequestId(),
          participant_name: name,
          email,
          organization,
          phone,
          consent,
          website,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body?.email?.[0] || body?.non_field_errors?.[0] || body?.detail || "Registration could not be completed.";
        throw new Error(typeof message === "string" ? message : "Registration could not be completed.");
      }
      if (!body?.management_token || body.email) throw new Error("Registration response was not public-safe.");
      setReceipt({
        status: body.status,
        management_token: body.management_token,
        waitlist_position: body.waitlist_position ?? null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      component="form"
      onSubmit={submit}
      aria-label="Event registration"
      sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560, py: 1 }}
    >
      <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>
        Register{event.registration_category ? ` · ${event.registration_category}` : ""}
      </Typography>
      {event.registration_notice ? <Typography color="text.secondary">{event.registration_notice}</Typography> : null}
      {state === "WAITLIST_AVAILABLE" ? (
        <Alert severity="info">Confirmed seats are full. New registrations join the waitlist.</Alert>
      ) : null}
      <TextField
        label="Full name"
        value={name}
        onChange={(eventChange) => setName(eventChange.target.value)}
        required={required.includes("participant_name")}
        disabled={busy}
        fullWidth
        autoComplete="name"
      />
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(eventChange) => setEmail(eventChange.target.value)}
        required={required.includes("email")}
        disabled={busy}
        fullWidth
        autoComplete="email"
      />
      {required.includes("organization") || organization ? (
        <TextField
          label="Organization"
          value={organization}
          onChange={(eventChange) => setOrganization(eventChange.target.value)}
          required={required.includes("organization")}
          disabled={busy}
          fullWidth
        />
      ) : (
        <TextField
          label="Organization (optional)"
          value={organization}
          onChange={(eventChange) => setOrganization(eventChange.target.value)}
          disabled={busy}
          fullWidth
        />
      )}
      {required.includes("phone") ? (
        <TextField
          label="Phone"
          value={phone}
          onChange={(eventChange) => setPhone(eventChange.target.value)}
          required
          disabled={busy}
          fullWidth
          autoComplete="tel"
        />
      ) : null}
      <Box sx={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }} aria-hidden>
        <TextField
          label="Website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(eventChange) => setWebsite(eventChange.target.value)}
        />
      </Box>
      <FormControlLabel
        control={<Checkbox checked={consent} onChange={(eventChange) => setConsent(eventChange.target.checked)} disabled={busy} />}
        label="I agree to be contacted about this Event and understand my details are held by this Site."
      />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button type="submit" variant="contained" disabled={busy || !consent}>
        {busy ? "Submitting…" : state === "WAITLIST_AVAILABLE" ? "Join waitlist" : "Submit registration"}
      </Button>
    </Box>
  );
}
