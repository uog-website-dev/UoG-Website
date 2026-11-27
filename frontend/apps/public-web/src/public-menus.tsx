"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { Box, Breadcrumbs as MuiBreadcrumbs, Button, Link, Typography } from "@mui/material";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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

const BreadcrumbTitleContext = createContext<((title: string | null) => void) | null>(null);

export function usePublicBreadcrumbTitle(title: string | null) {
  const setTitle = useContext(BreadcrumbTitleContext);
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}

function Breadcrumbs({ detailTitle }: { detailTitle: string | null }) {
  const pathname = usePathname() || "/";
  if (pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  let href = "";
  const isPostDetail = segments[0] === "posts" && segments.length === 2;
  const isEventDetail = segments[0] === "events" && segments.length === 2;
  // Title banners own the trail; keep this surface strip only for listing/archive views.
  return (
    <Box
      data-public-breadcrumbs=""
      sx={{
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        // Hide duplicate crumbs when a ContentBanner is present in main.
        'main:has([data-content-banner]) &, main:has([data-page-loading]) &': { display: "none" },
      }}
    >
      <Box sx={{ maxWidth: 1120, width: "100%", mx: "auto", px: { xs: 2, sm: 3, md: 4 }, py: 1.25 }}>
        <MuiBreadcrumbs
          aria-label="Breadcrumb"
          separator={<Box component="span" aria-hidden sx={{ color: "text.disabled", fontSize: "1.1rem", lineHeight: 1 }}>›</Box>}
          sx={{
            fontSize: ".875rem",
            fontWeight: 500,
            letterSpacing: "0.01em",
            "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap", alignItems: "center" },
            "& .MuiBreadcrumbs-li": { minWidth: 0, display: "inline-flex", alignItems: "center" },
          }}
        >
          <Link href="/" underline="hover" color="text.secondary" sx={{ whiteSpace: "nowrap", fontWeight: 500, minHeight: 44, display: "inline-flex", alignItems: "center" }}>Home</Link>
        {segments.map((segment, index) => {
          href += "/" + segment;
          const last = index === segments.length - 1;
          const words = decodeURIComponent(segment).replace(/-/g, " ");
          const label = segment === "posts"
            ? "News"
            : segment === "events"
              ? "Events"
              : segment === "categories"
                ? "Categories"
                : (isPostDetail || isEventDetail) && last
                  ? detailTitle || "Detail"
                  : words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
          return (
            <Box component="span" key={href} sx={{ minWidth: 0, display: "inline-flex" }}>
              {last ? (
                <Typography
                  component="span"
                  aria-current="page"
                  color="text.primary"
                  sx={{ display: "block", maxWidth: { xs: 180, sm: 360, md: 600 }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}
                >
                  {label}
                </Typography>
              ) : (
                <Link href={href} underline="hover" color="text.secondary" sx={{ whiteSpace: "nowrap", fontWeight: 500, minHeight: 44, display: "inline-flex", alignItems: "center" }}>{label}</Link>
              )}
            </Box>
          );
        })}
        </MuiBreadcrumbs>
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
  const [detailTitle, setDetailTitle] = useState<string | null>(null);
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
    <BreadcrumbTitleContext.Provider value={setDetailTitle}>
      <Link href="#main-content" sx={{ position: "absolute", left: 16, top: -100, zIndex: 1500, bgcolor: "background.paper", p: 2, "&:focus": { top: 12 } }}>Skip to content</Link>
      <PublicSiteHeader site={site} headerItems={menus.header} utilityItems={menus.utility ?? []} />
      <Box component="main" id="main-content" tabIndex={-1}>
        <Breadcrumbs detailTitle={detailTitle} />
        {children}
      </Box>
      <PublicSiteFooter site={site} items={menus.footer} />
      <BackToTop />
    </BreadcrumbTitleContext.Provider>
  );
}
