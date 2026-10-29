"use client";

/**
 * Shared platform chrome: branded header with slot-based actions, and a
 * simple footer. Both apps render these so navigation and branding stay
 * consistent while each app supplies its own links and session controls.
 */
import type { ReactNode } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

export function UogHeader({
  title,
  actions,
  leading,
}: {
  title: string;
  actions?: ReactNode;
  /**
   * Optional slot rendered before the brand mark — e.g. the admin console
   * passes a mobile navigation toggle that only appears on small screens.
   */
  leading?: ReactNode;
}) {
  return (
    <AppBar position="static" color="primary">
      <Toolbar disableGutters>
        <Container maxWidth="lg" sx={{ display: "flex", alignItems: "center", gap: 2, py: 0.75 }}>
          {leading}
          <Typography
            variant="h6"
            component="div"
            sx={{ fontWeight: 700, letterSpacing: 0.4, flexGrow: 0, flexShrink: 0, whiteSpace: "nowrap" }}
          >
            ⚙ UoG
          </Typography>
          <Typography
            variant="subtitle2"
            sx={{ opacity: 0.85, flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {title}
          </Typography>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0, whiteSpace: "nowrap" }}>{actions}</Box>
        </Container>
      </Toolbar>
    </AppBar>
  );
}

export function UogFooter({ apiBaseUrl }: { apiBaseUrl: string | undefined }) {
  return (
    <Box component="footer" sx={{ mt: "auto", py: 3, textAlign: "center" }}>
      <Typography variant="body2" color="text.secondary">
        © {new Date().getFullYear()} University of Gondar — Digital Platform
        (development environment)
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {apiBaseUrl != null && (
          <Link href={`${apiBaseUrl}/health/ready`} color="inherit">
            API health
          </Link>
        )}
      </Typography>
    </Box>
  );
}
