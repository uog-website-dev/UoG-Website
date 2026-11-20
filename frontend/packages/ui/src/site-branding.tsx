"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { EMPTY_SITE } from "./public-site";
import type { PublicSiteContext } from "./public-site";

const PublicSiteBrandingContext = createContext<PublicSiteContext>(EMPTY_SITE);

export function PublicSiteBrandingProvider({ site, children }: { site: PublicSiteContext; children: ReactNode }) {
  return <PublicSiteBrandingContext.Provider value={site}>{children}</PublicSiteBrandingContext.Provider>;
}

export function usePublicSiteBranding(): PublicSiteContext {
  return useContext(PublicSiteBrandingContext);
}

/** Responsive, Site-bound logo with a branded text fallback and no broken-image state. */
export function SiteBrandingMark({ site, size = 40 }: { site: PublicSiteContext; size?: number }) {
  const validLogo = site.logoUrl === "/api/v1/site-context/identity/logo/";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [site.id, site.logoUrl]);
  const dimensions = { xs: Math.max(32, size - 4), sm: size };

  if (!validLogo || failed) {
    return (
      <Box
        role="img"
        aria-label={`${site.displayName || "University of Gondar"} logo fallback`}
        sx={{
          width: dimensions,
          height: dimensions,
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "secondary.main",
          color: "secondary.contrastText",
          fontWeight: 800,
          fontSize: { xs: "0.7rem", sm: "0.8rem" },
          lineHeight: 1,
        }}
      >
        UoG
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src="/api/v1/site-context/identity/logo/"
      alt={`${site.displayName} logo`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      sx={{
        width: dimensions,
        height: dimensions,
        flex: "0 0 auto",
        objectFit: "contain",
        bgcolor: "common.white",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 0.25,
      }}
    />
  );
}

export function SiteBrandingLockup({
  site,
  compact = false,
  inverse = false,
}: {
  site: PublicSiteContext;
  compact?: boolean;
  inverse?: boolean;
}) {
  return (
    <Box
      component="div"
      role="group"
      aria-label={`${site.displayName} Site branding`}
      data-site-branding={site.code ?? "university"}
      sx={{ display: "inline-flex", alignItems: "center", gap: compact ? 1 : 1.5, minWidth: 0 }}
    >
      <SiteBrandingMark site={site} size={compact ? 32 : 44} />
      <Typography
        component="span"
        variant={compact ? "subtitle2" : "subtitle1"}
        sx={{
          minWidth: 0,
          overflowWrap: "anywhere",
          fontWeight: 700,
          color: inverse ? "primary.contrastText" : "text.primary",
        }}
      >
        {site.displayName}
      </Typography>
    </Box>
  );
}
