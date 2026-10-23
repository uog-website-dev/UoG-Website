"use client";

/**
 * Admin console application shell.
 *
 * Client component: it owns the mobile navigation drawer state so the header
 * toggle and the drawer stay in sync. Everything else (session actions,
 * page content) is passed in from the server layout as serialisable slots.
 */
import { useState } from "react";
import MenuIcon from "@mui/icons-material/Menu";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import { UogFooter, UogHeader } from "@uog/ui";
import type { ReactNode } from "react";

import { DesktopSidebar, MobileNavDrawer } from "@/sidebar";

/** Visually hidden until focused — first tab stop on every page. */
const skipLinkSx = {
  position: "absolute",
  left: 16,
  top: -60,
  zIndex: 1400,
  px: 2,
  py: 1,
  borderRadius: 2,
  bgcolor: "background.paper",
  color: "primary.main",
  fontWeight: 700,
  textDecoration: "none",
  boxShadow: 3,
  transition: "top 0.15s ease",
  "&:focus-visible": {
    top: 12,
  },
} as const;

export function AdminShell({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <Box
        component="a"
        href="#main-content"
        sx={skipLinkSx}
      >
        Skip to main content
      </Box>

      <UogHeader
        title="Digital Platform — Admin Console"
        actions={actions}
        leading={
          <IconButton
            edge="start"
            aria-label="Open navigation menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            sx={{
              display: { xs: "inline-flex", md: "none" },
              color: "inherit",
              mr: -1,
            }}
          >
            <MenuIcon />
          </IconButton>
        }
      />

      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <DesktopSidebar />
        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            py: { xs: 3, md: 4 },
            outline: "none",
          }}
        >
          <Container maxWidth="lg">{children}</Container>
        </Box>
      </Box>

      <UogFooter />
    </Box>
  );
}
