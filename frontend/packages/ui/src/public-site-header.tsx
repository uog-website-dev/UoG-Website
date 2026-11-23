"use client";
/**
 * The single public/preview header. The builder preview and the published Site
 * render the same component so width, search visibility, menus, the call to
 * action and sticky behaviour cannot drift.
 *
 * Navigation is never stored here: it comes from the Site's published `header`
 * and `secondary` menu locations.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import { headerSettingsFrom } from "@uog/types";
import type { SiteHeaderSettings } from "@uog/types";
import type { PublicSiteContext } from "./public-site";
import { SiteBrandingLockup } from "./site-branding";
import { PublicSiteSearch } from "./public-site-search";
import { SiteNavigation, safeMenuHref } from "./site-navigation";
import type { PublicMenuNode } from "./site-navigation";

const focus = { "&:focus-visible": { outline: "3px solid", outlineColor: "secondary.main", outlineOffset: 3 } };

/** Preview links must resolve on the public origin; published links stay relative. */
function destination(value: string, origin?: string, preview = false): string | null {
  const href = safeMenuHref(value);
  if (!href) return null;
  if (!preview) return href;
  if (href.startsWith("/") && !origin) return null;
  if (href.startsWith("/") && origin) {
    try {
      return new URL(href, origin).toString();
    } catch {
      return null;
    }
  }
  return href;
}

export interface PublicSiteHeaderProps {
  site: PublicSiteContext;
  headerItems?: PublicMenuNode[];
  utilityItems?: PublicMenuNode[];
  settings?: SiteHeaderSettings;
  siteOrigin?: string;
  preview?: boolean;
  /** Private-media logo used only by the builder preview. */
  previewLogo?: { assetId: string; mediaBase: string } | null;
}

export function PublicSiteHeader({
  site,
  headerItems = [],
  utilityItems = [],
  settings = site.header,
  siteOrigin,
  preview = false,
  previewLogo = null,
}: PublicSiteHeaderProps) {
  const config = headerSettingsFrom(settings);
  const brand = destination(config.brand_href, siteOrigin, preview) ?? (preview ? undefined : "/");
  const searchVisible = config.search_enabled && (site.modules.pages || site.modules.posts);
  // `config.language_switcher` is persisted and validated, but this platform
  // has no locale-prefixed public routes yet, so there is nothing to switch to
  // and no placeholder control is rendered.
  void config.language_switcher;
  const cta = config.cta_url && config.cta_label.trim()
    ? destination(config.cta_url, siteOrigin, preview)
    : null;
  const privateLogo = preview && previewLogo
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(previewLogo.assetId)
    && new RegExp(`^/(?:[A-Za-z0-9_-]+/)*sites/${site.id}/media$`).test(previewLogo.mediaBase)
    ? `${previewLogo.mediaBase}/${previewLogo.assetId}/image?variant=thumbnail`
    : null;

  return (
    <Box
      component="header"
      data-site-header={site.id ?? "unresolved"}
      data-site-header-sticky={config.sticky ? "true" : undefined}
      sx={{
        bgcolor: "primary.main",
        color: "primary.contrastText",
        ...(config.sticky ? { position: "sticky", top: 0, zIndex: 1200 } : {}),
        "& [data-nav-trigger]:hover, & [data-nav-trigger][aria-expanded=true]": { bgcolor: "rgba(255,255,255,.12)" },
        borderBottom: "3px solid",
        borderColor: "secondary.main",
        overflowWrap: "anywhere",
        pt: "env(safe-area-inset-top)",
      }}
    >
      {utilityItems.length ? (
        <Container maxWidth="lg" sx={{ display: { xs: "none", lg: "flex" }, justifyContent: "flex-end", borderBottom: "1px solid", borderColor: "rgba(255,255,255,.18)", "& nav": { px: 0 }, "& ul": { columnGap: 2 }, "& a": { fontSize: ".875rem", minHeight: 44 } }}>
          <SiteNavigation items={utilityItems} label="Site utility" />
        </Container>
      ) : null}
      <Container maxWidth="lg" data-mobile-header-row sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: { xs: 1, md: 2 }, "& [data-site-branding] > span": { fontSize: { xs: ".875rem", md: "1.2rem" }, letterSpacing: "-.015em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: { xs: 200, sm: "none" } }, "& [data-site-branding-mark]": { width: { xs: 40, md: 100 }, height: { xs: 40, md: 75 }, fontSize: { xs: ".7rem", md: "1rem" }, flexShrink: 0 }, minHeight: { xs: 64, md: 104 }, py: { xs: 0.5, md: 1.5 }, boxSizing: "border-box" }}>
        <Link
          href={brand ?? "/"}
          color="inherit"
          underline="none"
          target={preview ? "_blank" : undefined}
          rel={preview ? "noopener noreferrer" : undefined}
          sx={{ minWidth: 0, minHeight: 44, flex: "1 1 auto", display: "inline-flex", alignItems: "center", gap: 1.25, ...focus }}
        >
          {privateLogo ? <Box component="img" src={privateLogo} alt={`${site.displayName} logo`} sx={{ width: { xs: 40, md: 100 }, height: { xs: 40, md: 75 }, objectFit: "contain", flex: "0 0 auto" }} /> : <SiteBrandingLockup site={site} inverse />}
          {privateLogo ? <Box component="span" sx={{ fontWeight: 700 }}>{site.displayName}</Box> : null}
        </Link>
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, gap: { xs: 0.5, md: 1 } }}>
          <SiteNavigation items={headerItems} label="Site header" mobile drawerSections={[
            ...(utilityItems.length ? [{ label: "Site utility", items: utilityItems }] : []),
            ...(cta ? [{ label: "Quick links", items: [], action: { label: config.cta_label, href: cta } }] : []),
          ]} />
          {cta ? (
            <Button
              component="a"
              href={cta}
              target={preview ? "_blank" : undefined}
              rel={preview ? "noopener noreferrer" : undefined}
              sx={{ display: { xs: "none", md: "inline-flex" }, bgcolor: "secondary.main", color: "secondary.contrastText", fontWeight: 700, whiteSpace: "nowrap", "&:hover": { bgcolor: "secondary.dark" }, ...focus }}
            >
              {config.cta_label}
            </Button>
          ) : null}
          {searchVisible ? <PublicSiteSearch site={site} /> : null}
        </Box>
      </Container>
    </Box>
  );
}
