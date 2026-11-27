"use client";

/**
 * Admin console navigation.
 *
 * `SidebarNav` is the single source of truth for the navigation list and is
 * rendered twice: as a persistent desktop rail and inside the mobile drawer.
 * It adapts to the current workspace: Platform Administration shows the
 * platform sections this account holds platform-scoped permissions for, and
 * a Site workspace shows that Site's sections for its enabled modules and
 * Site-scoped permissions. Links use `next/link` so the Next.js `basePath`
 * (`/admin`) is applied — plain `<a>` tags would escape the console.
 */
import VerticalAlignBottomOutlinedIcon from "@mui/icons-material/VerticalAlignBottomOutlined";
import VerticalAlignTopOutlinedIcon from "@mui/icons-material/VerticalAlignTopOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import CloseIcon from "@mui/icons-material/Close";
import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArticleIcon from "@mui/icons-material/Article";
import GroupIcon from "@mui/icons-material/Group";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DescriptionIcon from "@mui/icons-material/Description";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";
import Link from "next/link";

import {
  hasPlatformWorkspace,
  isNavItemActive,
  normalizeAdminPathname,
  siteWorkspaceId,
  visiblePlatformNavItems,
} from "@/navigation";
import { siteAdminHref, visibleSiteSections, isSiteSectionActive } from "@/sites/site-admin";
import type { SiteSection } from "@/sites/site-admin";
import { siteStatusChip } from "@/sites/validation";
import {
  useWorkspace,
} from "@/workspace";
import type { WorkspaceState } from "@/workspace";
import {WorkspaceSwitcher} from "@/workspace-switcher";
import {useSectionPrefetch} from "@/data/section-prefetch";
import {APP_BASE_PATH} from "@/base-path";

const DRAWER_WIDTH = 296;

const SITE_SECTION_ICONS: Record<SiteSection["key"], SvgIconComponent> = {
  dashboard: DashboardIcon,
  pages: DescriptionIcon,
  sidebars: AccountTreeIcon,
  builder: ViewQuiltIcon,
  homepage: HomeOutlinedIcon,
  appearance: PaletteOutlinedIcon,
  header: VerticalAlignTopOutlinedIcon,
  footer: VerticalAlignBottomOutlinedIcon,
  posts: ArticleIcon,
  documents: DescriptionIcon,
  menus: AccountTreeIcon,
  media: ArticleIcon,
  users: GroupIcon,
};

const SITE_SECTION_DESCRIPTIONS: Record<SiteSection["key"], string> = {
  dashboard: "Site content overview",
  pages: "Site pages and workflow",
  sidebars: "Reusable Page navigation regions",
  builder: "Compose a visual Page layout",
  homepage: "Assign the published Site root",
  appearance: "Site logo, public title and theme",
  header: "Header branding, navigation, search and call to action",
  footer: "Footer content, contact and social links",
  posts: "News and announcements",
  documents: "Official Site documents",
  menus: "Header and footer navigation",
  media: "Private Site media library",
  users: "Site members and roles",
};

function SidebarBrand() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box component="img" src={`${APP_BASE_PATH}/uog-main-logo.webp`} alt="University of Gondar logo"
        sx={{ width: 52, height: 42, flexShrink: 0, objectFit: "contain", borderRadius: 1, bgcolor: "common.white" }} />
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

function NavItem({
  href,
  label,
  description,
  icon: Icon,
  active,
  onNavigate,
  onIntent,
  onEndIntent,
}: {
  href: string;
  label: string;
  description: string;
  icon: SvgIconComponent;
  active: boolean;
  onNavigate?: () => void;
  onIntent?: () => void;
  onEndIntent?: () => void;
}) {
  return (
    <ListItemButton
      component={Link}
      href={href}
      selected={active}
      onClick={onNavigate}
      prefetch={onIntent ? false : undefined}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      onPointerLeave={onEndIntent}
      onBlur={onEndIntent}
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
        primary={label}
        secondary={description}
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
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);
  const siteId = siteWorkspaceId(currentPath);
  const state = useWorkspace(siteId);
  const siteOnlyWorkspace = siteId !== null
    && (state.status !== "ready" || !hasPlatformWorkspace(state.data.platformPermissions));

  return (
    <Box data-perf-navigation-ready={state.status === "ready" ? "true" : "false"} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {!siteOnlyWorkspace ? <Box sx={{ px: 2.75 }}>
        <WorkspaceSwitcher state={state} onNavigate={onNavigate} />
      </Box> : null}
      {siteId == null ? (
        <PlatformNav state={state} currentPath={currentPath} onNavigate={onNavigate} />
      ) : (
        <SiteNav state={state} siteId={siteId} currentPath={currentPath} onNavigate={onNavigate} />
      )}
    </Box>
  );
}

function NavStatus({ state }: { state: WorkspaceState }) {
  if (state.status === "loading") {
    return (
      <Typography role="status" variant="body2" color="text.secondary" sx={{ px: 1.25 }}>
        Loading navigation…
      </Typography>
    );
  }
  return (
    <Alert severity="warning" variant="outlined" sx={{ mx: 0.5 }}>
      {state.status === "error" && state.signedOut
        ? "Your session has expired. Sign out and sign in again."
        : "Navigation could not be loaded. Reload the page to try again."}
    </Alert>
  );
}

function PlatformNav({
  state,
  currentPath,
  onNavigate,
}: {
  state: WorkspaceState;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const items = state.status === "ready" ? visiblePlatformNavItems(state.data.platformPermissions) : [];
  return (
    <Box
      component="nav"
      aria-label="Admin sections"
      sx={{ display: "flex", flexDirection: "column", gap: 0.75, px: 1.5 }}
    >
      <Typography
        variant="overline"
        sx={{ px: 1.25, pb: 0.5, color: "text.secondary", fontWeight: 700, letterSpacing: 1.1 }}
      >
        Platform administration
      </Typography>
      {state.status !== "ready" ? <NavStatus state={state} /> : null}
      {state.status === "ready" && items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{px: 1.25}}>
          Platform administration is not assigned to this account. Choose a Site workspace above.
        </Typography>
      ) : null}
      {items.map((item) => (
        <NavItem
          key={item.key}
          href={item.href}
          label={item.label}
          description={item.description}
          icon={item.icon}
          active={isNavItemActive(item, currentPath)}
          onNavigate={onNavigate}
        />
      ))}
    </Box>
  );
}

function SiteNav({
  state,
  siteId,
  currentPath,
  onNavigate,
}: {
  state: WorkspaceState;
  siteId: number;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const prefetch = useSectionPrefetch(siteId);
  const data = state.status === "ready" ? state.data : null;
  const site = data?.site?.id === siteId ? data.site : null;
  const access = data?.site;
  const sections = access ? visibleSiteSections(access) : [];
  const chip = site ? siteStatusChip(site.status) : null;

  return (
    <Box
      component="nav"
      aria-label="Site sections"
      sx={{ display: "flex", flexDirection: "column", gap: 0.75, px: 1.5 }}
    >
      <Typography
        variant="overline"
        sx={{ px: 1.25, pb: 0.5, color: "text.secondary", fontWeight: 700, letterSpacing: 1.1 }}
      >
        Site administration
      </Typography>
      {state.status !== "ready" ? <NavStatus state={state} /> : null}
      {data && (!site || !access) ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.25 }}>
          This Site is not available to your account.
        </Typography>
      ) : null}
      {site && chip ? (
        <Box sx={{ px: 1.25, pb: 0.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{site.name}</Typography>
            <Chip size="small" variant="outlined" color={chip.color} label={chip.label} />
          </Box>
          {site.primaryDomain?.hostname ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
              {site.primaryDomain.hostname}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {site && access ? sections.map((section) => {
        const href = siteAdminHref(siteId, section.segment);
        const active = isSiteSectionActive(section,siteId,currentPath);
        return (
          <NavItem
            key={section.key}
            href={href}
            label={section.label}
            description={SITE_SECTION_DESCRIPTIONS[section.key]}
            icon={SITE_SECTION_ICONS[section.key]}
            active={active}
            onNavigate={onNavigate}
            onIntent={["pages", "posts", "documents", "menus", "media"].includes(section.key) && !active ? () => prefetch.schedule(section.key) : undefined}
            onEndIntent={prefetch.cancel}
          />
        );
      }) : null}
    </Box>
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

/** Slide-in navigation for mobile and tablet — rendered inside the layout's drawer. */
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
          maxWidth: "100vw",
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
