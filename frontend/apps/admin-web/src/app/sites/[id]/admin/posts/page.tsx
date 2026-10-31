"use client";

import Typography from "@mui/material/Typography";

import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePostsAdminPage() {
  const { site } = useSiteAdmin();
  return (
    <SiteSection sectionKey="posts">
      <Typography>
        Posts are enabled for {site.name}. This console does not edit posts
        until that module is shipped.
      </Typography>
    </SiteSection>
  );
}
