"use client";

import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { SiteStaffDirectoryNav } from "@/sites/site-staff-directory-nav";
import { useSiteAdmin } from "@/sites/site-admin-frame";

export function SiteStaffDirectoryList() {
  const { site } = useSiteAdmin();
  return (
    <Stack spacing={3}>
      <SiteStaffDirectoryNav
        title="All Staff"
        description={`Authorized Staff Directory profiles for ${site.name}. Profile authoring ships in a later story.`}
      />
      <Alert severity="info">
        Staff profiles are not managed in this activation story. Enable Directory Settings to configure
        public scope and presentation for this Site.
      </Alert>
      <Typography color="text.secondary" role="status">
        No Staff profiles to list yet.
      </Typography>
    </Stack>
  );
}

export function SiteStaffDirectoryNew() {
  const { site } = useSiteAdmin();
  return (
    <Stack spacing={3}>
      <SiteStaffDirectoryNav
        title="Add New"
        description={`Create a Staff Directory profile for ${site.name} once profile authoring is available.`}
      />
      <Alert severity="info">
        Adding Staff profiles is reserved for a later Staff Directory story. Configure the module under
        Directory Settings.
      </Alert>
    </Stack>
  );
}
