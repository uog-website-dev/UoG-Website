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
    }}>
      {children}
    </Container>
  );

  return (
    <UogThemeProvider theme={site.theme}>
      <PublicSiteBrandingProvider site={site}>
        <div data-public-site="true" data-theme={site.theme} data-site-code={site.code ?? ""} data-site-name={site.displayName}>
          <PublicMenus>{body}</PublicMenus>
        </div>
      </PublicSiteBrandingProvider>
    </UogThemeProvider>
  );
}
