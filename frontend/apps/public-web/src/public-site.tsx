"use client";

/**
 * One public application for every Site.
 *
 * The Site comes from GET /api/v1/site-context/, which the backend fills
 * from the trusted Host. The header, theme and module widgets follow that
 * payload. A platform host keeps the empty context and does not borrow a
 * college Site.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { PublicSiteBrandingProvider, UogThemeProvider, EMPTY_SITE, publicFetchInit, siteFromContext } from "@uog/ui";
import type { PublicSiteContext } from "@uog/ui";

import { PublicMenus } from "@/public-menus";

const CONTEXT_PATH = "/api/v1/site-context/";

export function PublicSiteChrome({ children, initialSite = EMPTY_SITE }: { children: ReactNode; initialSite?: PublicSiteContext }) {
  const [site, setSite] = useState<PublicSiteContext>(initialSite);

  const pending = useRef<AbortController | null>(null);
  const refreshSite = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    fetch(CONTEXT_PATH, {...publicFetchInit(), signal: controller.signal})
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .catch(() => EMPTY_SITE)
      .then(next => { if (!controller.signal.aborted) setSite(next); });
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refreshSite);
    document.addEventListener("visibilitychange", refreshSite);
    return () => {
      pending.current?.abort();
      window.removeEventListener("focus", refreshSite);
      document.removeEventListener("visibilitychange", refreshSite);
    };
  }, [refreshSite]);

  const body = (
    <Container maxWidth="lg" sx={{
      py: { xs: 3, md: 5 }, display: "flex", flexDirection: "column", minHeight: "65vh",
      "& [data-layout-version] p": { lineHeight: 1.75 },
      // A visual Page owns its own safe gutter (see @uog/ui resolvePageWidth),
      // so the shell must not add a second inset.
      "&:has([data-page-width])": { px: 0 },
      // Wide/Reading caps must apply to the whole viewport, not a 1200 px shell.
      "&:has([data-page-layout='FULL_WIDTH'][data-page-width])": { maxWidth: "none" },
      // Only an explicit Page bleed releases the surrounding shell.
      "&:has([data-page-bleed='true'])": {maxWidth:"none",px:0,py:0},
    }}>
      {children}
    </Container>
  );

  return (
    <UogThemeProvider theme={site.theme}>
      <PublicSiteBrandingProvider site={site}>
        <Box
          data-public-site="true"
          data-theme={site.theme}
          data-site-code={site.code ?? ""}
          data-site-name={site.displayName}
          sx={{
            // A Page that opts out of global chrome carries its own navigation
            // bar, so the shell header and footer leave layout and the
            // accessibility tree together.
            "&:has([data-page-chrome='none'])": {"& header[data-site-header], & footer": {display: "none"}},
          }}
        >
          <PublicMenus>{body}</PublicMenus>
        </Box>
      </PublicSiteBrandingProvider>
    </UogThemeProvider>
  );
}
