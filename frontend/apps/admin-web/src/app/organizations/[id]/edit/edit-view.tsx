"use client";

/**
 * Edit screen chrome around the shared `OrganizationForm`.
 *
 * Kept as a client component so the error branch can reuse `ApiErrorState`
 * (a client component) and so the form's toast/router navigation have the
 * client runtime they need. The organization payload and ETag arrive as
 * serialisable props from the server page; the access token never does.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

import { ApiErrorState } from "@uog/ui";
import type { ApiError } from "@uog/api-client";
import type { Organization } from "@uog/types";

import { Breadcrumb } from "@/breadcrumb";
import { OrganizationForm } from "@/organizations/organization-form";
import { organizationTypeLabel } from "@/organizations/validation";

interface EditOrganizationViewProps {
  organization: Organization | null;
  etag: string | null;
  /** Correlation id from a failed read, shown when `organization` is null. */
  error?: ApiError;
  requestId?: string;
}

export function EditOrganizationView({
  organization,
  etag,
  error,
  requestId,
}: EditOrganizationViewProps) {
  if (!organization) {
    const failure =
      error ??
      ({
        status: 0,
        code: "api_error",
        message: "The organization could not be loaded.",
        details: null,
        requestId: requestId ?? null,
      } as ApiError);

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations", href: "/organizations" },
            { label: "Not available" },
          ]}
        />
        <ApiErrorState error={failure} onRetry={() => window.location.reload()} />
      </Box>
    );
  }

  const statusColor =
    organization.status === "ACTIVE"
      ? "success"
      : organization.status === "INACTIVE"
        ? "warning"
        : "default";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations", href: "/organizations" },
            { label: organization.name },
          ]}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {organization.name}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={statusColor}
            label={organization.status.charAt(0) + organization.status.slice(1).toLowerCase()}
          />
        </Box>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {organizationTypeLabel(organization.organization_type)} · code{" "}
          <Box component="span" sx={{ fontFamily: "monospace" }}>
            {organization.code}
          </Box>
          {organization.parent === null
            ? " · institutional root (cannot be moved or retyped)"
            : ""}
        </Typography>
      </Box>

      <OrganizationForm organization={organization} etag={etag} />
    </Box>
  );
}
