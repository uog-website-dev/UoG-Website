"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { Box, Container, Link, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SiteNavigation, SiteBrandingLockup, usePublicSiteBranding, menusFromResponse, publicFetchInit } from "@uog/ui";
import type { PublicMenuNode } from "@uog/ui";

const EMPTY: { header: PublicMenuNode[]; footer: PublicMenuNode[]; utility?: PublicMenuNode[] } = {
  header: [],
  footer: [],
};

export const PUBLIC_MENUS_PATH = "/api/v1/site-context/menus/";

export function PublicMenus({ children }: { children: ReactNode }) {
  const site = usePublicSiteBranding();
  const [loaded, setLoaded] = useState({siteId: site.id, menus: EMPTY});
  const menus = site.modules.menus && loaded.siteId === site.id ? loaded.menus : EMPTY;

  useEffect(() => {
    if (!site.modules.menus) return;
    let cancelled = false;
    fetch(PUBLIC_MENUS_PATH, publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setLoaded({siteId: site.id, menus: menusFromResponse(response.status, body)});
      })
      .catch(() => {
        if (!cancelled) setLoaded({siteId: site.id, menus: EMPTY});
      });
    return () => { cancelled = true; };
  }, [site.id, site.modules.menus]);

  return <>
    <Link href="#main-content" sx={{position:"absolute",left:16,top:-100,zIndex:1500,bgcolor:"background.paper",p:2,"&:focus":{top:12}}}>Skip to content</Link>
    <Box component="header" sx={{bgcolor:"primary.main",color:"primary.contrastText",borderBottom:"3px solid",borderColor:"secondary.main"}}>
      {menus.utility?.length ? <Container maxWidth="lg" sx={{display:"flex",justifyContent:"flex-end",borderBottom:"1px solid",borderColor:"rgba(255,255,255,.18)"}}><SiteNavigation items={menus.utility} label="Site utility" mobile/></Container> : null}
      <Container maxWidth="lg" sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,"& [data-site-branding] > span":{fontSize:{xs:".95rem",md:"1.2rem"},letterSpacing:"-.015em"},minHeight:{xs:80,md:104},py:2}}>
        <Link href="/" color="inherit" underline="none" sx={{minWidth:0,"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:6}}}><SiteBrandingLockup site={site} inverse/></Link>
        <SiteNavigation items={menus.header} label="Site header" mobile/>
      </Container>
    </Box>
    <Box component="main" id="main-content" tabIndex={-1}>{children}</Box>
    <Box component="footer" sx={{bgcolor:"primary.main",color:"primary.contrastText",mt:6,borderTop:"4px solid",borderColor:"secondary.main"}}>
      <Container maxWidth="lg" sx={{py:{xs:4,md:6},display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-start",gap:4}}>
        <Box><SiteBrandingLockup site={site} inverse/><Typography sx={{mt:2,opacity:.85,maxWidth:360}}>{site.displayName === "University of Gondar" ? "University of Gondar" : "Part of the University of Gondar"}</Typography></Box>
        <SiteNavigation items={menus.footer} label="Site footer"/>
      </Container>
      <Container maxWidth="lg" sx={{py:2.5,borderTop:"1px solid",borderColor:"rgba(255,255,255,.2)"}}><Typography variant="body2">&copy; {new Date().getFullYear()} {site.displayName}. All rights reserved.</Typography></Container>
    </Box>
  </>;
}
