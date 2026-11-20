"use client";

/**
 * One public application for every Site.
 *
 * The Site comes from GET /api/v1/site-context/, which the backend fills
 * from the trusted Host. The header, theme and module widgets follow that
 * payload. A platform host keeps the empty context and does not borrow a
 * college Site.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Container from "@mui/material/Container";
import { PublicSiteBrandingProvider, SiteBrandingLockup, SiteBrandingMark, UogFooter, UogHeader, UogThemeProvider, EMPTY_SITE, publicFetchInit, siteFromContext } from "@uog/ui";
import type { PublicSiteContext } from "@uog/ui";

import { PublicMenus } from "@/public-menus";

const CONTEXT_PATH = "/api/v1/site-context/";

export function PublicSiteChrome({ children, initialSite = EMPTY_SITE }: { children: ReactNode; initialSite?: PublicSiteContext }) {
  const [site, setSite] = useState<PublicSiteContext>(initialSite);

  const refreshSite = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    fetch(CONTEXT_PATH, publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .catch(() => EMPTY_SITE)
      .then(setSite);
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refreshSite);
    document.addEventListener("visibilitychange", refreshSite);
    return () => {
      window.removeEventListener("focus", refreshSite);
      document.removeEventListener("visibilitychange", refreshSite);
    };
  }, [refreshSite]);

  const body = (
    <Container maxWidth="lg" sx={{ py: 4, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      {children}
    </Container>
  );

  return (
    <UogThemeProvider theme={site.theme}>
      <PublicSiteBrandingProvider site={site}>
        <div data-theme={site.theme} data-site-code={site.code ?? ""} data-site-name={site.displayName}>
          <UogHeader title={site.displayName} brand={<SiteBrandingMark site={site} />} />
          {site.modules.menus ? <PublicMenus>{body}</PublicMenus> : body}
          <UogFooter apiBaseUrl={undefined} brand={<SiteBrandingLockup site={site} compact />} />
        </div>
      </PublicSiteBrandingProvider>
    </UogThemeProvider>
  );
}
