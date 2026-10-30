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
import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";
import Link from "next/link";

import { adminNavItems, isNavItemActive, normalizeAdminPathname } from "@/navigation";
import { AccessNav } from "@/access-nav";

const DRAWER_WIDTH = 296;

function SidebarBrand() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box
        aria-hidden="true"
        sx={{
          display: "grid",
          placeItems: "center",
          width: 42,
          height: 42,
          flexShrink: 0,
          borderRadius: 2.5,
          color: "common.white",
          background: "linear-gradient(145deg, #064b86 0%, #003366 100%)",
          boxShadow: "0 5px 12px rgba(0, 51, 102, 0.2)",
        }}
      >
        <AccountBalanceRoundedIcon fontSize="small" />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={800} color="text.primary">
          UoG Administration
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Digital platform
        </Typography>
      </Box>
    </Box>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);

  return (
    <AccessNav items={adminNavItems}>
      {(visibleItems) => (
        <Box
          component="nav"
          aria-label="Admin sections"
          sx={{ display: "flex", flexDirection: "column", gap: 0.75, px: 1.5, py: 1 }}
        >
          <Typography
            variant="overline"
            sx={{ px: 1.25, pb: 0.5, color: "text.secondary", fontWeight: 700, letterSpacing: 1.1 }}
          >
            Workspace
          </Typography>
          {visibleItems.map((item) => {
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
              position: "relative",
              minHeight: 58,
              borderRadius: 2.5,
              px: 1.25,
              py: 0.75,
              color: active ? "common.white" : "text.primary",
              transition: "background-color 150ms ease, transform 150ms ease",
              "&:hover": {
                backgroundColor: active ? "primary.dark" : "action.hover",
                transform: "translateX(2px)",
              },
              "&.Mui-selected": {
                backgroundColor: "primary.main",
                boxShadow: "0 5px 14px rgba(0, 51, 102, 0.16)",
              },
              "&.Mui-selected:hover": {
                backgroundColor: "primary.dark",
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 42,
                color: active ? "primary.main" : "text.secondary",
                "& > .MuiSvgIcon-root": {
                  display: "grid",
                  placeItems: "center",
                  boxSizing: "content-box",
                  width: 20,
                  height: 20,
                  p: 0.75,
                  borderRadius: 1.75,
                  backgroundColor: active ? "common.white" : "action.hover",
                },
              }}
            >
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              secondary={item.description}
              primaryTypographyProps={{
                fontWeight: active ? 700 : 600,
                fontSize: 14,
                color: active ? "common.white" : "text.primary",
              }}
              secondaryTypographyProps={{
                fontSize: 11.5,
                color: active ? "rgba(255,255,255,0.76)" : "text.secondary",
              }}
            />
          </ListItemButton>
        );
          })}
        </Box>
      )}
    </AccessNav>
  );
}

/**
 * Persistent left rail — visible on desktop (md and up).
 *
 * The rail is a plain flex column that fills the shell's middle row exactly
 * (`height: "100%"` of a row the viewport lock already constrains). It never
 * scrolls with the page: the brand stays pinned at the top, the link list
 * gets its own scrollbar (`overflowY: "auto"`) when the navigation outgrows
 * the viewport, and the workspace card stays pinned at the bottom.
 */
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
        bgcolor: "#f8fafc",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 2.5, py: 2.25, borderBottom: 1, borderColor: "divider" }}>
        <SidebarBrand />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 2 }}>
        <SidebarNav />
      </Box>
      <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            p: 1.5,
            borderRadius: 2.5,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              display: "grid",
              placeItems: "center",
              width: 30,
              height: 30,
              flexShrink: 0,
              borderRadius: 1.75,
              color: "primary.main",
              bgcolor: "action.hover",
            }}
          >
            <AccountBalanceRoundedIcon sx={{ fontSize: 17 }} />
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={700} display="block">
              Admin workspace
            </Typography>
            <Typography variant="caption" color="text.secondary">
              University of Gondar
            </Typography>
          </Box>
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
          bgcolor: "#f8fafc",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <SidebarBrand />
        <IconButton
          edge="end"
          aria-label="Close navigation menu"
          onClick={onClose}
          size="small"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", py: 2 }}>
        <SidebarNav onNavigate={onClose} />
      </Box>
      <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
          University of Gondar · Admin workspace
        </Typography>
      </Box>
    </Drawer>
  );
}
