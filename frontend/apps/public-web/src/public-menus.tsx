"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { Box, Link } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PublicSiteHeader, PublicSiteFooter, usePublicSiteBranding, menusFromResponse, publicFetchInit } from "@uog/ui";
import type { PublicMenuNode } from "@uog/ui";
import { menuPayloadForSite } from "@uog/ui/public-site";
import type { PublicMenusPayload } from "@uog/ui/public-site";

const EMPTY: { header: PublicMenuNode[]; footer: PublicMenuNode[]; utility?: PublicMenuNode[] } = {
  header: [],
  footer: [],
};

export const PUBLIC_MENUS_PATH = "/api/v1/site-context/menus/";

export function PublicMenus({ children, initialMenus = null }: { children: ReactNode; initialMenus?: PublicMenusPayload | null }) {
  const site = usePublicSiteBranding();
  // The server already resolved menus for this Host. Parse the same payload on
  // the server render and on hydration so the first HTML contains navigation
  // and both renders agree.
  const serverMenus = useMemo(() => {
    const payload = menuPayloadForSite(initialMenus, site.id);
    return payload ? menusFromResponse(200, payload) : EMPTY;
  }, [initialMenus, site.id]);
  const [loaded, setLoaded] = useState({siteId: site.id, menus: serverMenus});
  const skipInitialFetch = useRef(Boolean(menuPayloadForSite(initialMenus, site.id)));
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
    if(skipInitialFetch.current)skipInitialFetch.current=false;else refresh();
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{active=false;pending?.abort();window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  }, [site.id, site.modules.menus]);

  return <>
    <Link href="#main-content" sx={{position:"absolute",left:16,top:-100,zIndex:1500,bgcolor:"background.paper",p:2,"&:focus":{top:12}}}>Skip to content</Link>
    <PublicSiteHeader site={site} headerItems={menus.header} utilityItems={menus.utility ?? []} />
    <Box component="main" id="main-content" tabIndex={-1}>{children}</Box>
    <PublicSiteFooter site={site} items={menus.footer}/>
  </>;
}
