"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { Box, Container, Link } from "@mui/material";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PublicSiteSearch, PublicSiteFooter, SiteNavigation, SiteBrandingLockup, usePublicSiteBranding, menusFromResponse, publicFetchInit } from "@uog/ui";
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
    let active=true;let pending:AbortController|null=null;
    const refresh=()=>{
      if(document.visibilityState==="hidden")return;
      pending?.abort();const controller=new AbortController();pending=controller;
      void fetch(PUBLIC_MENUS_PATH,{...publicFetchInit(),signal:controller.signal})
        .then(async response=>{
          const body=response.ok?await response.json().catch(()=>null):null;
          if(active&&!controller.signal.aborted)setLoaded({siteId:site.id,menus:body?.site===site.id?menusFromResponse(response.status,body):EMPTY});
        }).catch(()=>{if(active&&!controller.signal.aborted)setLoaded({siteId:site.id,menus:EMPTY});});
    };
    refresh();window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{active=false;pending?.abort();window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  }, [site.id, site.modules.menus]);

  return <>
    <Link href="#main-content" sx={{position:"absolute",left:16,top:-100,zIndex:1500,bgcolor:"background.paper",p:2,"&:focus":{top:12}}}>Skip to content</Link>
    <Box component="header" sx={{bgcolor:"primary.main",color:"primary.contrastText","& [data-nav-trigger]:hover,& [data-nav-trigger][aria-expanded=true]":{bgcolor:"rgba(255,255,255,.12)"},borderBottom:"3px solid",borderColor:"secondary.main"}}>
      {menus.utility?.length ? <Container maxWidth="lg" sx={{display:"flex",justifyContent:"flex-end",borderBottom:"1px solid",borderColor:"rgba(255,255,255,.18)","& nav":{px:0},"& ul":{columnGap:2},"& a":{fontSize:".875rem",minHeight:44}}}><SiteNavigation items={menus.utility} label="Site utility"/></Container> : null}
      <Container maxWidth="lg" sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,"& [data-site-branding] > span":{fontSize:{xs:".95rem",md:"1.2rem"},letterSpacing:"-.015em"},minHeight:{xs:80,md:104},py:2}}>
        <Link href="/" color="inherit" underline="none" sx={{minWidth:0,"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:6}}}><SiteBrandingLockup site={site} inverse/></Link>
        <Box sx={{display:"flex",alignItems:"center",minWidth:0}}><SiteNavigation items={menus.header} label="Site header" mobile/><PublicSiteSearch site={site}/></Box>
      </Container>
    </Box>
    <Box component="main" id="main-content" tabIndex={-1}>{children}</Box>
    <PublicSiteFooter site={site} items={menus.footer}/>
  </>;
}
