"use client";

/**
 * Administration chrome for one Site inside the shared console.
 *
 * The Site selector only offers the sites the caller already loaded for
 * this user. Changing the Site opens that Site's dashboard, and the
 * workspace remounts so a draft form cannot follow the user.
 */
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Breadcrumb } from "@/breadcrumb";
import { normalizeAdminPathname } from "@/navigation";
import {
  canActivateCentralModules,
  sectionByKey,
  sectionDecision,
  siteAdminHref,
  siteSwitchHref,
  visibleSiteSections,
} from "@/sites/site-admin";
import type { SectionDecision, SiteAccessInput, SiteSection } from "@/sites/site-admin";

export interface SiteAdminSite {
  id: number;
  name: string;
  code: string;
  status: string;
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

function SectionLinks({
  siteId,
  sections,
  currentPath,
  onNavigate,
}: {
  siteId: number;
  sections: SiteSection[];
  currentPath: string;
  onNavigate?: () => void;
}) {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 0.5 }}>
      {sections.map((section) => {
        const href = siteAdminHref(siteId, section.segment);
        const active = currentPath === href;
        return (
          <Box component="li" key={section.key}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
            >
              {section.label}
            </Link>
          </Box>
        );
      })}
    </Box>
  );
}

export function SiteAdminFrame({
  site,
  sites,
  enabledModuleCodes,
  permissions,
  children,
}: SiteAdminValue & {
  sites: SiteAdminSite[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = normalizeAdminPathname(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const access = { enabledModuleCodes, permissions };
  const sections = visibleSiteSections(access);
  const current = sections.find((section) => section.segment && currentPath === siteAdminHref(site.id, section.segment));
  const value = { site, enabledModuleCodes, permissions };

  return (
    <SiteAdminContext.Provider value={value}>
    <Box key={site.id} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Sites", href: "/sites" },
          { label: site.name, href: `/sites/${site.id}` },
          { label: current?.label ?? "Administration" },
        ]}
      />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between" }}>
        <Box>
          <Typography variant="overline" color="primary.main">Site administration</Typography>
          <Typography variant="h4" component="h1">{site.name}</Typography>
          <Typography variant="body2" color="text.secondary">{site.code} · {site.status}</Typography>
        </Box>
        <Box>
          <Typography component="label" htmlFor="site-admin-selector" sx={{ display: "block", fontSize: 12, mb: 0.5 }}>
            Site
          </Typography>
          <select
            id="site-admin-selector"
            aria-label="Site"
            value={String(site.id)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (next !== site.id) router.push(siteSwitchHref(next));
            }}
            style={{ minWidth: 220, minHeight: 40, font: "inherit" }}
          >
            {sites.map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.name}</option>
            ))}
          </select>
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
        <Box
          component="nav"
          aria-label="Site sections"
          sx={{ display: { xs: "none", md: "block" }, minWidth: 180 }}
        >
          <SectionLinks siteId={site.id} sections={sections} currentPath={currentPath} />
        </Box>
        <Button
          variant="outlined"
          startIcon={<MenuIcon />}
          aria-expanded={menuOpen}
          aria-controls="site-admin-menu"
          onClick={() => setMenuOpen(true)}
          sx={{ display: { xs: "inline-flex", md: "none" } }}
        >
          Open site menu
        </Button>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Box>
      {canActivateCentralModules(permissions) ? (
        <Link href="/modules">Central module registry</Link>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Central module activation stays in platform administration.
        </Typography>
      )}
      <Drawer anchor="left" open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Box
          id="site-admin-menu"
          sx={{ width: 280, p: 2 }}
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenuOpen(false);
          }}
        >
          <IconButton aria-label="Close site menu" onClick={() => setMenuOpen(false)}>
            <CloseIcon />
          </IconButton>
          <SectionLinks
            siteId={site.id}
            sections={sections}
            currentPath={currentPath}
            onNavigate={() => setMenuOpen(false)}
          />
        </Box>
      </Drawer>
    </Box>
    </SiteAdminContext.Provider>
  );
}

export function SiteAdminDenied({ sites }: { sites: SiteAdminSite[] }) {
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
  const message = decision === "module_disabled"
    ? `${label} are not enabled for this Site.`
    : `You do not have permission to open ${label} for this Site.`;
  return <Alert severity="warning">{message}</Alert>;
}

export function SiteSection({
  sectionKey,
  children,
}: {
  sectionKey: SiteSection["key"];
  children: ReactNode;
}) {
  const admin = useSiteAdmin();
  const decision = sectionDecision(sectionByKey(sectionKey), admin);
  if (decision !== "visible") {
    return <SectionBlocked label={sectionByKey(sectionKey).label} decision={decision} />;
  }
  return children;
}
