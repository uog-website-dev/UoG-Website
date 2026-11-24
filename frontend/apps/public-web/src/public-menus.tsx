"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { Box, Button, Link } from "@mui/material";
import { usePathname } from "next/navigation";
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

function Breadcrumbs() {
  const pathname = usePathname() || "/";
  if (pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  let href = "";
  return (
    <Box component="nav" aria-label="Breadcrumb" sx={{ py: 1 }}>
      <Box component="ol" sx={{ display: "flex", flexWrap: "wrap", gap: 1, listStyle: "none", p: 0, m: 0, fontSize: ".875rem" }}>
        {segments.map((segment, index) => {
          href += "/" + segment;
          const last = index === segments.length - 1;
          const label = decodeURIComponent(segment).replace(/-/g, " ");
          return (
            <Box component="li" key={href} sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
              {index > 0 ? <span aria-hidden>/</span> : null}
              {last ? (
                <Box component="span" aria-current="page" sx={{ fontWeight: 700 }}>{label}</Box>
              ) : (
                <Link href={href}>{label}</Link>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Button
      aria-label="Back to top"
      onClick={() => {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      }}
      sx={{
        position: "fixed",
        bottom: "calc(24px + env(safe-area-inset-bottom))",
        right: "calc(16px + env(safe-area-inset-right))",
        zIndex: 1200,
        width: 48,
        height: 48,
        minWidth: 48,
        minHeight: 48,
        p: 0,
        borderRadius: "50%",
        bgcolor: "#003366",
        color: "#ffffff",
        border: "2px solid #ffffff",
        boxShadow: "0 6px 18px rgba(0, 51, 102, 0.35)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 180ms ease, transform 180ms ease, background-color 150ms ease",
        "&:hover": { bgcolor: "#002a52", boxShadow: "0 8px 22px rgba(0, 51, 102, 0.45)" },
        "&:focus-visible": { outline: "3px solid #FFB81C", outlineOffset: 3 },
      }}
    >
      <Box
        component="svg"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        sx={{ width: 24, height: 24, display: "block" }}
      >
        <path d="M12 5 5 12l1.5 1.5L11 9v10h2V9l4.5 4.5L19 12z" fill="currentColor" />
      </Box>
    </Button>
  );
}

export function PublicMenus({ children, initialMenus = null }: { children: ReactNode; initialMenus?: PublicMenusPayload | null }) {
  const site = usePublicSiteBranding();
  const serverMenus = useMemo(() => {
    const payload = menuPayloadForSite(initialMenus, site.id);
    return payload ? menusFromResponse(200, payload) : EMPTY;
  }, [initialMenus, site.id]);
  const [loaded, setLoaded] = useState({ siteId: site.id, menus: serverMenus });
  const skipInitialFetch = useRef(Boolean(menuPayloadForSite(initialMenus, site.id)));
  const menus = site.modules.menus && loaded.siteId === site.id ? loaded.menus : EMPTY;

  useEffect(() => {
    if (!site.modules.menus) return;
    let active = true;
    let pending: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void fetch(PUBLIC_MENUS_PATH, { ...publicFetchInit(), signal: controller.signal })
        .then(async (response) => {
          const body = response.ok ? await response.json().catch(() => null) : null;
          if (active && !controller.signal.aborted) {
            setLoaded({ siteId: site.id, menus: body?.site === site.id ? menusFromResponse(response.status, body) : EMPTY });
          }
        })
        .catch(() => {
          if (active && !controller.signal.aborted) setLoaded({ siteId: site.id, menus: EMPTY });
        });
    };
    if (skipInitialFetch.current) skipInitialFetch.current = false;
    else refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      pending?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [site.id, site.modules.menus]);

  return (
    <>
      <Link href="#main-content" sx={{ position: "absolute", left: 16, top: -100, zIndex: 1500, bgcolor: "background.paper", p: 2, "&:focus": { top: 12 } }}>Skip to content</Link>
      <PublicSiteHeader site={site} headerItems={menus.header} utilityItems={menus.utility ?? []} />
      <Box component="main" id="main-content" tabIndex={-1}>
        <Breadcrumbs />
        {children}
      </Box>
      <PublicSiteFooter site={site} items={menus.footer} />
      <BackToTop />
    </>
  );
}