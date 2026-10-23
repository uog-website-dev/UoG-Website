"use client";

/**
 * Admin console navigation.
 *
 * `SidebarNav` is the single source of truth for the navigation list and is
 * rendered twice: as a persistent desktop rail and inside the mobile drawer.
 * Links use `next/link` so the Next.js `basePath` (`/admin`) is applied —
 * plain `<a>` tags would escape the console.
 */
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { usePathname } from "next/navigation";
import Link from "next/link";

import { adminNavItems, isNavItemActive, normalizeAdminPathname } from "@/navigation";

const DRAWER_WIDTH = 280;

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);

  return (
    <Box
      component="nav"
      aria-label="Admin sections"
      sx={{ display: "flex", flexDirection: "column", gap: 0.5, p: 1.5 }}
    >
      {adminNavItems.map((item) => {
        const active = isNavItemActive(item, currentPath);
        const Icon = item.icon;
        return (
          <ListItemButton
            key={item.key}
            component={Link}
            href={item.href}
            selected={active}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            sx={{
              borderRadius: 2,
              py: 1,
              color: active ? "primary.main" : "text.primary",
              "&:hover": {
                backgroundColor: "action.hover",
              },
              "&.Mui-selected": {
                backgroundColor: "action.selected",
                borderLeft: 3,
                borderColor: "secondary.main",
                pl: 1.75,
              },
              "&.Mui-selected:hover": {
                backgroundColor: "action.selected",
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: active ? "primary.main" : "text.secondary",
              }}
            >
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              secondary={item.description}
              primaryTypographyProps={{ fontWeight: active ? 700 : 500, fontSize: 14.5 }}
              secondaryTypographyProps={{ fontSize: 12 }}
            />
          </ListItemButton>
        );
      })}
    </Box>
  );
}

/** Persistent left rail — visible on desktop (md and up). */
export function DesktopSidebar() {
  return (
    <Box
      component="aside"
      sx={{
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        width: DRAWER_WIDTH,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        minHeight: "calc(100vh - 64px)",
      }}
    >
      <Box sx={{ px: 3, py: 2.5, borderBottom: 1, borderColor: "divider" }}>
        <Box
          component="p"
          sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "text.secondary" }}
        >
          Administration
        </Box>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", py: 1.5 }}>
        <SidebarNav />
      </Box>
      <Box sx={{ px: 3, py: 2, borderTop: 1, borderColor: "divider" }}>
        <Box component="p" sx={{ m: 0, fontSize: 11.5, color: "text.secondary" }}>
          Shell preview — data-backed screens are not connected yet.
        </Box>
      </Box>
    </Box>
  );
}

/** Slide-in navigation for mobile — rendered inside the layout's drawer. */
export function MobileNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: DRAWER_WIDTH,
          bgcolor: "background.paper",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box
          component="p"
          sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "text.secondary" }}
        >
          Administration
        </Box>
        <IconButton
          edge="end"
          aria-label="Close navigation menu"
          onClick={onClose}
          size="small"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", py: 1.5 }}>
        <SidebarNav onNavigate={onClose} />
      </Box>
    </Drawer>
  );
}
