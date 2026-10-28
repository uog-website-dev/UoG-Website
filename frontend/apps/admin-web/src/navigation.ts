import DashboardIcon from "@mui/icons-material/Dashboard";
import BusinessIcon from "@mui/icons-material/Business";
import ExtensionIcon from "@mui/icons-material/Extension";
import LanguageIcon from "@mui/icons-material/Language";
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
}

/**
 * Primary navigation of the admin console shell.
 *
 * Every entry must point at a route that exists in this app; none of them
 * may claim to be backed by a live data source until the corresponding
 * management story lands.
 */
export const adminNavItems: AdminNavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    description: "Console overview",
    icon: DashboardIcon,
  },
  {
    key: "organizations",
    label: "Organizations",
    href: "/organizations",
    description: "Institutional structure",
    icon: BusinessIcon,
  },
  {
    key: "sites",
    label: "Sites",
    href: "/sites",
    description: "Managed websites",
    icon: WebIcon,
  },
  {
    key: "domains",
    label: "Domains",
    href: "/domains",
    description: "Website addresses",
    icon: LanguageIcon,
  },
  {
    key: "modules",
    label: "Modules",
    href: "/modules",
    description: "Capability registry",
    icon: ExtensionIcon,
  },
];

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
