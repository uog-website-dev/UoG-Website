"use client";

/**
 * Administration chrome for one Site inside the shared console.
 *
 * Section navigation and the workspace selector live in the console rail,
 * so this frame only keeps the active Site visible: name, status, code and
 * owning organization. Only the editable content boundary remounts per Site.
 */
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import BusinessIcon from "@mui/icons-material/Business";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { SiteStatus } from "@uog/types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Breadcrumb } from "@/breadcrumb";
import { normalizeAdminPathname } from "@/navigation";
import {
  canActivateCentralModules,
  findSiteSection,
  sectionDecision,
  siteAdminHref,
  isSiteSectionActive,
  siteSwitchHref,
  visibleSiteSections,
} from "@/sites/site-admin";
import type { SectionDecision, SiteAccessInput, SiteSection } from "@/sites/site-admin";
import { siteStatusChip } from "@/sites/validation";
import { ViewPublicSite } from "@/sites/view-public-site";

function SiteEditableContent({children}: {children: ReactNode}) {
  const changedForms = useRef(new Set<HTMLFormElement>());
  useEffect(() => {
    const guard = (event: Event) => {
      const detail = (event as CustomEvent<{dirty: boolean}>).detail;
      for (const form of changedForms.current) {
        if (!form.isConnected) changedForms.current.delete(form);
        else if (detail) detail.dirty = true;
      }
    };
    window.addEventListener("uog:site:before-switch", guard);
    return () => window.removeEventListener("uog:site:before-switch", guard);
  }, []);
  return <Box sx={{minWidth: 0}} onChange={event => {
    // Filters are not drafts. Forms (including portalled dialogs) are isolated.
    const form = (event.target as HTMLElement).closest("form");
    if (form && form.getAttribute("role") !== "search") changedForms.current.add(form);
  }}>{children}</Box>;
}

export interface SiteAdminSite {
  id: number;
  name: string;
  code: string;
  status: SiteStatus;
  /** `null` when this account cannot read the owning organization. */
  organizationName?: string | null;
  organizationId?: number;
  defaultLanguage?: string;
  enabledLanguages?: readonly string[];
  primaryDomain?: { hostname: string; status: "ACTIVE" | "INACTIVE" } | null;
  /** Assigned published root Page UUID when configured. */
  homepageId?: string | null;
}

interface SiteAdminValue extends SiteAccessInput {
  site: SiteAdminSite;
}

const SiteAdminContext = createContext<SiteAdminValue | null>(null);

export function useSiteAdmin(): SiteAdminValue {
  const value = useContext(SiteAdminContext);
  if (!value) {
    throw new Error("Site administration is only available inside its workspace.");
  }
  return value;
}

function organizationLabel(site: SiteAdminSite): string {
  if (site.organizationName) return site.organizationName;
  if (site.organizationId != null) return `Organization unit #${site.organizationId}`;
  return "Organization unavailable";
}

export function SiteAdminFrame({
  site,
  enabledModuleCodes,
  permissions,
  children,
}: SiteAdminValue & {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);
  const access = { enabledModuleCodes, permissions };
  const sections = visibleSiteSections(access);
  const current = sections.find(
    (section) => isSiteSectionActive(section,site.id,currentPath),
  );
  const value = useMemo(() => ({site, enabledModuleCodes, permissions}), [site, enabledModuleCodes, permissions]);
  const chip = siteStatusChip(site.status);
  const dashboardHref = siteAdminHref(site.id);
  const onDashboard = currentPath === dashboardHref || currentPath === `${dashboardHref}/`;
  if(
    /^\/sites\/[1-9][0-9]*\/admin\/pages\/[^/]+\/(builder|preview)\/?$/.test(currentPath)
    || /^\/sites\/[1-9][0-9]*\/admin\/menus\/preview\/?$/.test(currentPath)
    || /^\/sites\/[1-9][0-9]*\/admin\/posts\/[^/]+\/preview\/?$/.test(currentPath)
  ){
    return <SiteAdminContext.Provider value={value}><SiteEditableContent key={site.id}>{children}</SiteEditableContent></SiteAdminContext.Provider>;
  }

  return (
    <SiteAdminContext.Provider value={value}>
    <Box data-perf-site-id={site.id} sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ position: "sticky", top: 0, zIndex: 10, bgcolor: "grey.50", pb: 1 }}>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: site.name, href: dashboardHref },
            { label: current?.label ?? "Dashboard" },
          ]}
        />
        {onDashboard ? (
          <Paper
            component="section"
            aria-label="Active Site"
            variant="outlined"
            sx={{
              p: { xs: 2, sm: 3 },
              borderRadius: 3,
              borderLeft: 4,
              borderLeftColor: "secondary.main",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Typography variant="overline" color="primary.main" sx={{ fontWeight: 700, letterSpacing: 1.1 }}>
              Site administration
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                {site.name}
              </Typography>
              {chip ? <Chip size="small" variant="outlined" color={chip.color} label={chip.label} /> : null}
            </Box>
            <Box sx={{ display: "flex", gap: { xs: 1, sm: 3 }, flexWrap: "wrap", color: "text.secondary" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <LanguageRoundedIcon sx={{ fontSize: 18 }} aria-hidden="true" />
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{site.code}</Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <BusinessIcon sx={{ fontSize: 18 }} aria-hidden="true" />
                <Typography variant="body2">{organizationLabel(site)}</Typography>
              </Box>
            </Box>
            <ViewPublicSite
              siteName={site.name}
              siteStatus={site.status}
              primaryDomain={site.primaryDomain}
            />
          </Paper>
        ) : null}
      </Box>
      <SiteEditableContent key={site.id}>{children}</SiteEditableContent>
      {canActivateCentralModules(permissions) ? (
        <Button component={Link} href="/modules" size="small" sx={{ alignSelf: "flex-start" }}>
          Central module registry
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Central module activation stays in platform administration.
        </Typography>
      )}
    </Box>
    </SiteAdminContext.Provider>
  );
}

export function SiteAdminDenied({ sites }: { sites: Pick<SiteAdminSite, "id" | "name">[] }) {
  const router = useRouter();
  return (
    <Alert severity="warning" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      This Site is not available to your account.
      {sites.length > 0 ? (
        <select
          aria-label="Site"
          defaultValue=""
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next > 0) router.push(siteSwitchHref(next));
          }}
        >
          <option value="" disabled>Choose a Site</option>
          {sites.map((choice) => (
            <option key={choice.id} value={choice.id}>{choice.name}</option>
          ))}
        </select>
      ) : null}
    </Alert>
  );
}

export function SectionBlocked({
  label,
  decision,
}: {
  label: string;
  decision: Exclude<SectionDecision, "visible">;
}) {
  const verb = /s$/i.test(label) && !/Builder$/i.test(label) ? "are" : "is";
  const message = decision === "module_disabled"
    ? `${label} ${verb} not enabled for this Site.`
    : `You do not have permission to open ${label} for this Site.`;
  return <Alert severity="warning">{message}</Alert>;
}

export function SiteSection({
  sectionKey,
  children,
}: {
  sectionKey: SiteSection["key"] | string;
  children: ReactNode;
}) {
  const admin = useSiteAdmin();
  const section = findSiteSection(sectionKey);
  if (!section) {
    return (
      <Alert severity="error" role="alert">
        Unknown site section{sectionKey ? `: ${sectionKey}` : ""}.
      </Alert>
    );
  }
  const decision = sectionDecision(section, admin);
  if (decision !== "visible") {
    return <SectionBlocked label={section.label} decision={decision} />;
  }
  return children;
}
