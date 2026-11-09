"use client";

import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

type PrimaryDomain = { hostname: string; status: "ACTIVE" | "INACTIVE" } | null | undefined;

/** A safe, Site-specific public link sourced from the Sites API's primary domain. */
export function ViewPublicSite({
  siteName,
  siteStatus,
  primaryDomain,
  compact = false,
}: {
  siteName: string;
  siteStatus: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  primaryDomain: PrimaryDomain;
  compact?: boolean;
}) {
  const hostname = primaryDomain?.hostname;
  const validHostname = typeof hostname === "string" && hostname.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
  const active = siteStatus === "ACTIVE" && primaryDomain?.status === "ACTIVE";
  const message = !validHostname
    ? "This Site has no usable primary hostname. Set an active primary domain in Domains."
    : siteStatus !== "ACTIVE"
      ? `This Site is ${siteStatus.toLowerCase()} and is not available as a public website.`
      : primaryDomain?.status !== "ACTIVE"
        ? "The primary hostname is inactive. Activate it in Domains to open the public website."
        : null;

  // The hostname comes from the API as a bare validated domain. Protocol
  // relative navigation preserves the Admin Console's supported HTTP(S) scheme.
  const href = validHostname ? `//${hostname}/` : undefined;

  return (
    <Box sx={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
      <Button
        component="a"
        href={active ? href : undefined}
        target={active ? "_blank" : undefined}
        rel={active ? "noopener noreferrer" : undefined}
        aria-label={`View ${siteName} public website${hostname ? ` at ${hostname}` : ""}`}
        variant={compact ? "text" : "outlined"}
        size={compact ? "small" : "medium"}
        startIcon={<OpenInNewRoundedIcon />}
        disabled={!active || !href}
        title={message ?? `Opens ${hostname} in a new tab`}
      >
        View Public Website
      </Button>
      {validHostname && !compact ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {hostname}
        </Typography>
      ) : null}
      {message ? (
        compact ? (
          <Typography role="status" variant="caption" color="text.secondary" sx={{ maxWidth: 240 }}>
            {message}
          </Typography>
        ) : (
          <Alert severity="info" sx={{ py: 0, "& .MuiAlert-message": { py: 0.5 } }}>
            {message}
          </Alert>
        )
      ) : null}
    </Box>
  );
}
