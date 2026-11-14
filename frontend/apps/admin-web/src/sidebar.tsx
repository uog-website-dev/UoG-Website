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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter } from "next/navigation";
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
  PLATFORM_WORKSPACE,
  useWorkspace,
  workspaceHref,
  workspaceValue,
} from "@/workspace";
import type { WorkspaceState } from "@/workspace";

const DRAWER_WIDTH = 296;

const SITE_SECTION_ICONS: Record<SiteSection["key"], SvgIconComponent> = {
  dashboard: DashboardIcon,
  pages: DescriptionIcon,
  sidebars: AccountTreeIcon,
  builder: ViewQuiltIcon,
  homepage: HomeOutlinedIcon,
  posts: ArticleIcon,
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
  posts: "News and announcements",
  menus: "Header and footer navigation",
  media: "Private Site media library",
  users: "Site members and roles",
};

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

function NavItem({
  href,
  label,
  description,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  description: string;
  icon: SvgIconComponent;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ListItemButton
      component={Link}
      href={href}
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

function WorkspaceSwitcher({
  state,
  siteId,
  onNavigate,
}: {
  state: WorkspaceState;
  siteId: number | null;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const data = state.status === "ready" ? state.data : null;
  const platform = data ? hasPlatformWorkspace(data.platformPermissions) : false;
  const sites = data?.sites ?? [];
  const value = workspaceValue(siteId);
  const known = (value === PLATFORM_WORKSPACE && platform) || sites.some((row) => workspaceValue(row.id) === value);

  return (
    <TextField
      select
      fullWidth
      size="small"
      label="Workspace"
      value={known ? value : ""}
      disabled={!data || (!platform && sites.length === 0)}
      onChange={(event) => {
        const href = workspaceHref(event.target.value);
        if (!href || event.target.value === value) return;
        onNavigate?.();
        router.push(href);
      }}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      helperText={state.status === "loading" ? "Loading workspaces…" : undefined}
    >
      {!known ? <option value="" disabled>Choose a workspace</option> : null}
      {platform ? <option value={PLATFORM_WORKSPACE}>Platform administration</option> : null}
      {sites.length > 0 ? (
        <optgroup label="Sites">
          {sites.map((row) => (
            <option key={row.id} value={workspaceValue(row.id)}>{row.name}</option>
          ))}
        </optgroup>
      ) : null}
    </TextField>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);
  const siteId = siteWorkspaceId(currentPath);
  const state = useWorkspace(siteId);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ px: 2.75 }}>
        <WorkspaceSwitcher state={state} siteId={siteId} onNavigate={onNavigate} />
        {state.status === "ready" && state.data.sitesError ? (
          <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
            Site workspaces could not be loaded: {state.data.sitesError}
          </Alert>
        ) : null}
      </Box>
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
      {state.status === "ready" && items.length === 0 && !state.data.sitesError ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.25 }}>
          {state.data.sites.length > 0
            ? "Platform administration is not assigned to this account. Choose a Site workspace above."
            : "No administration workspace is assigned to this account."}
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
  const data = state.status === "ready" ? state.data : null;
  const site = data?.sites.find((row) => row.id === siteId) ?? null;
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
      {data && !data.sitesError && (!site || !access) ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.25 }}>
          This Site is not available to your account.
        </Typography>
      ) : null}
      {site && chip ? (
        <Box sx={{ px: 1.25, pb: 0.5, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{site.name}</Typography>
          <Chip size="small" variant="outlined" color={chip.color} label={chip.label} />
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
