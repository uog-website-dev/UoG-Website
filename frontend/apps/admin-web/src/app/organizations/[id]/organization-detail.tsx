"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BusinessRoundedIcon from "@mui/icons-material/BusinessRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SearchOffRoundedIcon from "@mui/icons-material/SearchOffRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { ApiErrorState } from "@uog/ui";
import { ApiError } from "@uog/api-client";
import type { Organization } from "@uog/types";

import { Breadcrumb } from "@/breadcrumb";
import { deserializeApiError } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";
import { organizationTypeLabel } from "@/organizations/validation";

interface OrganizationDetailProps {
  organization: Organization | null;
  error?: ApiErrorPayload;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date);
}

export function OrganizationDetail({ organization, error }: OrganizationDetailProps) {
  if (!organization) {
    const failure = error
      ? deserializeApiError(error)
      : new ApiError("The organization could not be loaded.", 0, {
          code: "api_error",
        });

    if (failure.status === 404) {
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Breadcrumb
            items={[
              { label: "Home", href: "/" },
              { label: "Organizations", href: "/organizations" },
              { label: "Unavailable" },
            ]}
          />
          <Paper
            variant="outlined"
            sx={{
              overflow: "hidden",
              borderRadius: 3,
              textAlign: "center",
            }}
          >
            <Box
              sx={{
                display: "grid",
                justifyItems: "center",
                gap: 1.5,
                px: 3,
                py: { xs: 6, sm: 8 },
                background:
                  "linear-gradient(145deg, rgba(0,51,102,0.07), rgba(255,184,28,0.12))",
              }}
            >
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 64,
                  height: 64,
                  borderRadius: 3,
                  bgcolor: "background.paper",
                  color: "primary.main",
                  boxShadow: 1,
                }}
              >
                <SearchOffRoundedIcon fontSize="large" />
              </Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mt: 1 }}>
                Organization unavailable
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
                This organization may no longer exist or may not be available to
                your account. Return to the directory to check the current list.
              </Typography>
              <Button
                component={Link}
                href="/organizations"
                variant="contained"
                startIcon={<ArrowBackIcon />}
                sx={{ mt: 1 }}
              >
                Back to organizations
              </Button>
            </Box>
            {failure.requestId ? (
              <>
                <Divider />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", px: 2, py: 1.5, fontFamily: "monospace" }}
                >
                  Reference: {failure.requestId}
                </Typography>
              </>
            ) : null}
          </Paper>
        </Box>
      );
    }

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations", href: "/organizations" },
            { label: "Not available" },
          ]}
        />
        <ApiErrorState
          error={failure}
          onRetry={() => window.location.reload()}
        />
      </Box>
    );
  }

  const status =
    organization.status === "ACTIVE"
      ? { color: "success" as const, label: "Active" }
      : organization.status === "INACTIVE"
        ? { color: "warning" as const, label: "Inactive" }
        : { color: "default" as const, label: "Archived" };

  const fields = [
    { label: "Code", value: organization.code, monospace: true },
    { label: "Type", value: organizationTypeLabel(organization.organization_type) },
    {
      label: "Parent organization ID",
      value: organization.parent === null ? "Root organization" : `Unit #${organization.parent}`,
    },
    { label: "Short name", value: organization.short_name || "—" },
    { label: "Description", value: organization.description || "—" },
    { label: "Created", value: formatTimestamp(organization.created_at) },
    { label: "Last updated", value: formatTimestamp(organization.updated_at) },
  ];

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
        <Paper
          variant="outlined"
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 3,
            p: { xs: 2.5, sm: 4 },
            background:
              "linear-gradient(125deg, rgba(0,51,102,0.08) 0%, rgba(255,255,255,1) 58%, rgba(255,184,28,0.13) 100%)",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: "0 auto 0 0",
              width: 5,
              bgcolor: "secondary.main",
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
              <Box
                sx={{
                  display: { xs: "none", sm: "grid" },
                  placeItems: "center",
                  flex: "0 0 auto",
                  width: 56,
                  height: 56,
                  borderRadius: 2.5,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  boxShadow: 2,
                }}
              >
                <BusinessRoundedIcon />
              </Box>
              <Box>
                <Typography
                  variant="overline"
                  color="primary.main"
                  sx={{ fontWeight: 700, letterSpacing: 1.2 }}
                >
                  Organization profile
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.25 }}>
                  <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                    {organization.name}
                  </Typography>
                  <Chip
                    size="small"
                    color={status.color}
                    label={status.label}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  {organizationTypeLabel(organization.organization_type)}
                  {" · "}
                  <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                    {organization.code}
                  </Box>
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button
                component={Link}
                href="/organizations"
                startIcon={<ArrowBackIcon />}
                variant="outlined"
              >
                Directory
              </Button>
              <Button
                component={Link}
                href={`/organizations/${organization.id}/edit`}
                variant="contained"
                startIcon={<EditOutlinedIcon />}
              >
                Edit organization
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Organization information
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Approved profile fields returned by the organization service.
          </Typography>
        </Box>
        <Divider />
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 0,
            m: 0,
            "& > div": {
              px: { xs: 2, sm: 3 },
              py: 2.25,
              borderBottom: { xs: "1px solid", sm: "1px solid" },
              borderColor: "divider",
            },
            "& > div:nth-of-type(odd)": {
              bgcolor: "action.hover",
            },
          }}
        >
          {fields.map(({ label, value, monospace }) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography
                component="dt"
                variant="overline"
                color="text.secondary"
                sx={{ lineHeight: 1.5, letterSpacing: 0.7 }}
              >
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="body1"
                sx={{
                  m: 0,
                  mt: 0.5,
                  fontWeight: label === "Code" ? 600 : 400,
                  overflowWrap: "anywhere",
                  ...(monospace ? { fontFamily: "monospace" } : {}),
                }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
