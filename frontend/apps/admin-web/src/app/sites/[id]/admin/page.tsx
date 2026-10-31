"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { siteAdminHref, visibleSiteSections } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";

export default function SiteAdminHomePage() {
  const admin = useSiteAdmin();
  const sections = visibleSiteSections(admin).filter((section) => section.key !== "dashboard");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="h6" component="h2">Available sections</Typography>
      <Typography variant="body2" color="text.secondary">
        These are the content areas enabled for {admin.site.name}. Platform
        module activation is not managed here.
      </Typography>
      {sections.length === 0 ? (
        <Typography role="status">No content modules are available for this Site.</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {sections.map((section) => (
            <li key={section.key}>
              <Link href={siteAdminHref(admin.site.id, section.segment)}>{section.label}</Link>
            </li>
          ))}
        </Box>
      )}
    </Box>
  );
}
