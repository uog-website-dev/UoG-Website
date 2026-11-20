"use client";

/**
 * Chrome for the one public application.
 *
 * The title, theme and posts link come from the host-resolved Site. A
 * disabled module omits its widget. Menu links stay in PublicMenuFrame.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import type { PublicSiteContext } from "./public-site";
import { SiteBrandingLockup } from "./site-branding";

export function PublicSiteFrame({
  site,
  children,
}: {
  site: PublicSiteContext;
  children: ReactNode;
}) {
  return (
    <Box
      data-theme={site.theme}
      data-site-code={site.code ?? ""}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        bgcolor: "background.default",
        color: "text.primary",
      }}
    >
      {site.id !== null ? <SiteBrandingLockup site={site} compact /> : null}
      <Typography
        variant="h1"
        component="h1"
        sx={{ fontSize: { xs: "1.75rem", sm: "2.5rem" }, overflowWrap: "anywhere" }}
      >
        {site.displayName}
      </Typography>
      {site.modules.posts ? <Link href="/posts">Published posts</Link> : null}
      {children}
    </Box>
  );
}
