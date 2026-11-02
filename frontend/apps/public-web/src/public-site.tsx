"use client";

/**
 * One public application for every Site.
 *
 * The Site comes from GET /api/v1/site-context/, which the backend fills
 * from the trusted Host. The header, theme and module widgets follow that
 * payload. A platform host keeps the empty context and does not borrow a
 * college Site.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Container from "@mui/material/Container";
import { UogFooter, UogHeader, UogThemeProvider, EMPTY_SITE, publicFetchInit, siteFromContext } from "@uog/ui";
import type { PublicSiteContext } from "@uog/ui";

import { PublicMenus } from "@/public-menus";

const CONTEXT_PATH = "/api/v1/site-context/";

export function PublicSiteChrome({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<PublicSiteContext>(EMPTY_SITE);

  useEffect(() => {
    let cancelled = false;
    fetch(CONTEXT_PATH, publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .catch(() => EMPTY_SITE)
      .then((next) => {
        if (!cancelled) setSite(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (site.displayName) document.title = site.displayName;
  }, [site.displayName]);

  const body = (
    <Container maxWidth="lg" sx={{ py: 4, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      {children}
    </Container>
  );

  return (
    <UogThemeProvider theme={site.theme}>
      <div data-theme={site.theme} data-site-code={site.code ?? ""}>
        <UogHeader title={site.displayName} />
        {site.modules.menus ? <PublicMenus>{body}</PublicMenus> : body}
        <UogFooter apiBaseUrl={undefined} />
      </div>
    </UogThemeProvider>
  );
}
