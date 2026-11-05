import DashboardIcon from "@mui/icons-material/Dashboard";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import BusinessIcon from "@mui/icons-material/Business";
import ExtensionIcon from "@mui/icons-material/Extension";
import LanguageIcon from "@mui/icons-material/Language";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import WebIcon from "@mui/icons-material/Web";
import type { SvgIconComponent } from "@mui/icons-material";

import { APP_BASE_PATH } from "@/base-path";

export interface AdminNavItem {
  key: string;
  label: string;
  /** Path relative to the console base path (`/admin`). */
  href: string;
  description: string;
  icon: SvgIconComponent;
  requiresAny?: readonly string[];
}

/**
 * Primary navigation of the admin console shell.
 *
 * Every entry must point at a route that exists in this app. Restricted
 * sections declare the database permissions used for client-side visibility.
 */
export const adminNavItems: AdminNavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    description: "Console overview",
    icon: DashboardIcon,
    requiresAny: ["platform.dashboard.view"],
  },
  {
    key: "organizations",
    label: "Organizations",
    href: "/organizations",
    description: "Institutional structure",
    icon: BusinessIcon,
    requiresAny: ["platform.organizations.view"],
  },
  {
    key: "sites",
    label: "Sites",
    href: "/sites",
    description: "Managed websites",
    icon: WebIcon,
    requiresAny: ["sites.view"],
  },
  {
    key: "domains",
    label: "Domains",
    href: "/domains",
    description: "Website addresses",
    icon: LanguageIcon,
    requiresAny: ["sites.view"],
  },
  {
    key: "modules",
    label: "Modules",
    href: "/modules",
    description: "Capability registry",
    icon: ExtensionIcon,
    requiresAny: ["platform.sites.manage_registry"],
  },
  {
    key: "access",
    label: "Access control",
    href: "/access",
    description: "Roles, permissions and assignments",
    icon: AdminPanelSettingsIcon,
    requiresAny: ["platform.roles.view", "platform.roles.create", "platform.roles.update", "platform.roles.assign_permissions", "platform.users.view", "platform.users.assign_roles", "audit.logs.view"],
  },
];

/**
 * Platform entries for a scope-less permission set. Django reports only
 * platform-scoped grants without a Site, so a Site-only account gets none.
 */
export function visiblePlatformNavItems(platformPermissions: readonly string[]): AdminNavItem[] {
  return adminNavItems.filter(
    (item) => !item.requiresAny || item.requiresAny.some((code) => platformPermissions.includes(code)),
  );
}

export function hasPlatformWorkspace(platformPermissions: readonly string[]): boolean {
  return visiblePlatformNavItems(platformPermissions).length > 0;
}

/** The Site whose administration workspace a path belongs to, if any. */
export function siteWorkspaceId(path: string): number | null {
  const match = /^\/sites\/([1-9]\d*)\/admin(?:\/|$)/.exec(path);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * `usePathname()` may report the path with or without the Next.js `basePath`
 * depending on the call site — normalise both to an app-relative path so
 * active-navigation matching is deterministic.
 */
export function normalizeAdminPathname(pathname: string | null): string {
  if (!pathname) return "/";
  let path = pathname;
  if (path === APP_BASE_PATH || path.startsWith(`${APP_BASE_PATH}/`)) {
    path = path.slice(APP_BASE_PATH.length);
  }
  if (path === "") return "/";
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

/** Whether an app-relative path is the active navigation destination. */
export function isNavItemActive(item: AdminNavItem, currentPath: string): boolean {
  if (item.href === "/") return currentPath === "/";
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}
