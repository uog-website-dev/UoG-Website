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
        ...(site.theme === "high-contrast" ? { bgcolor: "#000", color: "#fff" } : {}),
      }}
    >
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
