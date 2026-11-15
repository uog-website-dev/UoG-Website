"use client";

import { useEffect, useState } from "react";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

type DomainRef = { hostname: string; status: "ACTIVE" | "INACTIVE" };

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True when the Admin Console is reached on a local development host. */
export function isLocalAdminHost(hostname = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".uog.local");
}

function validHostname(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 253 && HOSTNAME.test(value);
}

/**
 * Prefer an ACTIVE *.uog.local hostname for local browsing; otherwise the primary.
 * Production names like coi.uog.edu.et are not admitted by the local nginx ingress.
 */
export function publicPreviewHostname(
  primary: DomainRef | null | undefined,
  domains: readonly DomainRef[] = [],
  preferLocal = false,
): string | null {
  const active = [
    ...(validHostname(primary?.hostname) && primary?.status === "ACTIVE"
      ? [{ hostname: primary.hostname, status: primary.status } as DomainRef]
      : []),
    ...domains.filter((row) => validHostname(row.hostname) && row.status === "ACTIVE"),
  ];
  if (preferLocal) {
    const local = active.find((row) => row.hostname.endsWith(".uog.local"));
    if (local) return local.hostname;
  }
  if (validHostname(primary?.hostname) && primary?.status === "ACTIVE") return primary.hostname;
  return active[0]?.hostname ?? null;
}

/** A safe, Site-specific public link sourced from the Sites API domains. */
export function ViewPublicSite({
  siteName,
  siteStatus,
  primaryDomain,
  domains = [],
  compact = false,
  label = "View Public Website",
}: {
  siteName: string;
  siteStatus: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  primaryDomain: DomainRef | null | undefined;
  /** Extra Site domains (aliases). Used to pick *.uog.local in local development. */
  domains?: readonly DomainRef[];
  compact?: boolean;
  /** Button label; Homepage Settings uses Public Preview. */
  label?: string;
}) {
  const [preferLocal, setPreferLocal] = useState(false);
  useEffect(() => {
    setPreferLocal(isLocalAdminHost());
  }, []);

  const hostname = publicPreviewHostname(primaryDomain, domains, preferLocal);
  const primaryHostname = validHostname(primaryDomain?.hostname) ? primaryDomain!.hostname : null;
  const localHint =
    preferLocal
    && siteStatus === "ACTIVE"
    && primaryHostname
    && !primaryHostname.endsWith(".uog.local")
    && !hostname?.endsWith(".uog.local");

  const active = siteStatus === "ACTIVE" && Boolean(hostname);
  const message = !hostname
    ? "This Site has no usable active hostname. Set an active primary domain in Domains."
    : siteStatus !== "ACTIVE"
      ? `This Site is ${siteStatus.toLowerCase()} and is not available as a public website.`
      : localHint
        ? `Local development cannot open ${primaryHostname}. Add an ACTIVE domain such as ${suggestedLocalHostname(primaryHostname)} (do not enable redirect-to-primary), map it to 127.0.0.1 in your hosts file, then use that link.`
        : null;

  const href = hostname ? `//${hostname}/` : undefined;

  return (
    <Box sx={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
      <Button
        component="a"
        href={active && !localHint ? href : undefined}
        target={active && !localHint ? "_blank" : undefined}
        rel={active && !localHint ? "noopener noreferrer" : undefined}
        aria-label={`${label} for ${siteName}${hostname ? ` at ${hostname}` : ""}`}
        variant={compact ? "text" : "outlined"}
        size={compact ? "small" : "medium"}
        startIcon={<OpenInNewRoundedIcon />}
        disabled={!active || !href || Boolean(localHint)}
        title={message ?? `Opens ${hostname} in a new tab`}
      >
        {label}
      </Button>
      {hostname && !compact ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {hostname}
          {preferLocal && hostname.endsWith(".uog.local") && primaryHostname && primaryHostname !== hostname
            ? ` · local preview (primary ${primaryHostname})`
            : ""}
        </Typography>
      ) : null}
      {message ? (
        compact ? (
          <Typography role="status" variant="caption" color="text.secondary" sx={{ maxWidth: 320 }}>
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

function suggestedLocalHostname(productionHostname: string): string {
  const label = productionHostname.split(".")[0];
  return label && /^[a-z0-9-]+$/.test(label) ? `${label}.uog.local` : "college.uog.local";
}
