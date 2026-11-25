"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { EMPTY_SITE, publicLogoSource as getPublicLogoSource } from "./public-site";
import type { PublicSiteContext } from "./public-site";
export { publicLogoSource } from "./public-site";

const PublicSiteBrandingContext = createContext<PublicSiteContext>(EMPTY_SITE);

export function PublicSiteBrandingProvider({ site, children }: { site: PublicSiteContext; children: ReactNode }) {
  return <PublicSiteBrandingContext.Provider value={site}>{children}</PublicSiteBrandingContext.Provider>;
}

export function usePublicSiteBranding(): PublicSiteContext {
  return useContext(PublicSiteBrandingContext);
}

/** Responsive, Site-bound logo with a branded text fallback and no broken-image state. */
export function SiteBrandingMark({ site, size = 56, width = size }: { site: PublicSiteContext; size?: number; width?: number }) {
  const source = getPublicLogoSource(site);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [site]);
  const dimensions = size;

  if (!source || failed) {
    return (
      <Box
        role="img"
        data-site-branding-mark=""
        aria-label={`${site.displayName || "University of Gondar"} logo fallback`}
        sx={{
          width,
          height: dimensions,
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          border: 0,
          borderRadius: 1,
          bgcolor: "secondary.main",
          color: "secondary.contrastText",
          fontWeight: 800,
          fontSize: size>=80?`${Math.round(size*.22)}px`:{ xs: "0.7rem", sm: "0.8rem" },
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
      data-site-branding-mark=""
      src={source}
      alt={`${site.displayName} logo`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      sx={{
        width,
        height: dimensions,
        flex: "0 0 auto",
        objectFit: "contain",
        bgcolor: "transparent",
        border: 0,
        borderRadius: 0,
        boxSizing: "border-box",
      }}
    />
  );
}

export function SiteBrandingLockup({
  site,
  compact = false,
  inverse = false,
  quote = "",
}: {
  site: PublicSiteContext;
  compact?: boolean;
  inverse?: boolean;
  quote?: string;
}) {
  return (
    <Box
      component="div"
      role="group"
      aria-label={`${site.displayName} Site branding`}
      data-site-branding={site.code ?? "university"}
      sx={{ display: "inline-flex", alignItems: "center", gap: compact ? 1 : 1.5, minWidth: 0 }}
    >
      <SiteBrandingMark site={site} size={compact ? 44 : 75} width={compact ? 44 : 100} />
      <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Typography
          component="span"
          data-site-branding-name=""
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
        {quote.trim() ? (
          <Typography
            component="span"
            data-site-branding-quote=""
            variant="caption"
            sx={{ lineHeight: 1.2, fontStyle: "italic", color: inverse ? "primary.contrastText" : "text.secondary" }}
          >
            {quote}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
