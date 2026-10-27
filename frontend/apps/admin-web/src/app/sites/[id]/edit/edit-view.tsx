"use client";

/**
 * Edit screen chrome around the shared `SiteForm`.
 *
 * Kept as a client component so the error branch can reuse `ApiErrorState`
 * (a client component) and so the form's toast/router navigation have the
 * client runtime they need. The site payload arrives as a serialisable prop
 * from the server page; the access token never does.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

import { ApiErrorState } from "@uog/ui";
import type { ApiError } from "@uog/api-client";
import type { Site } from "@uog/types";

import { Breadcrumb } from "@/breadcrumb";
import { SiteForm } from "@/sites/site-form";
import { siteStatusChip } from "@/sites/validation";

interface EditSiteViewProps {
  site: Site | null;
  /** Correlation id from a failed read, shown when `site` is null. */
  error?: ApiError;
  requestId?: string;
}

export function EditSiteView({ site, error, requestId }: EditSiteViewProps) {
  if (!site) {
    const failure =
      error ??
      ({
        status: 0,
        code: "api_error",
        message: "The site could not be loaded.",
        details: null,
        requestId: requestId ?? null,
      } as ApiError);

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: "Not available" },
          ]}
        />
        <ApiErrorState error={failure} onRetry={() => window.location.reload()} />
      </Box>
    );
  }

  const chip = siteStatusChip(site.status);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: site.name },
          ]}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {site.name}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={chip.color}
            label={chip.label}
          />
        </Box>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          code{" "}
          <Box component="span" sx={{ fontFamily: "monospace" }}>
            {site.code}
          </Box>
          {" · "}
          {site.template === null
            ? "platform defaults"
            : `template #${site.template}`}
          {site.is_main ? " · main university site" : ""}
        </Typography>
      </Box>

      <SiteForm site={site} />
    </Box>
  );
}
