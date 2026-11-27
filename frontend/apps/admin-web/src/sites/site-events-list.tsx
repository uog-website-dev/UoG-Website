"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { eventAdminHref } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteEventsNav } from "@/sites/site-events-nav";

export function SiteEventsList() {
  const { site } = useSiteAdmin();
  return (
    <Stack spacing={3}>
      <SiteEventsNav
        title="All Events"
        description={`Administer Events published for ${site.name}.`}
      />
      <Alert severity="info">
        Event records will appear here after Event authoring is available. Configuration and categories are ready under Event Settings.
      </Alert>
      <Typography color="text.secondary">No Events yet.</Typography>
      <Button component={Link} href={eventAdminHref(site.id, "/new")} variant="contained" sx={{ alignSelf: "flex-start" }}>
        Add New Event
      </Button>
    </Stack>
  );
}

export function SiteEventsNew() {
  const { site } = useSiteAdmin();
  return (
    <Stack spacing={3}>
      <SiteEventsNav
        title="Add New Event"
        description={`Create an Event for ${site.name}.`}
      />
      <Alert severity="info">
        Event creation opens in a follow-on story. Use Event Settings to configure timezone, routes, registration defaults and categories now.
      </Alert>
      <Button component={Link} href={eventAdminHref(site.id, "/settings")} variant="outlined" sx={{ alignSelf: "flex-start" }}>
        Open Event Settings
      </Button>
    </Stack>
  );
}
