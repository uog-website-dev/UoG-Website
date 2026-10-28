/**
 * Admin dashboard — console entry point.
 *
 * The Organizations, Sites and Modules sections are live-wired: their
 * screens read and write through the Django API using server actions, so
 * the Keycloak access token stays server-side and the backend remains the
 * authority on permissions, concurrency and lifecycle rules. The single
 * diagnostic on this page is the clearly-labelled backend readiness probe.
 */
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BusinessIcon from "@mui/icons-material/Business";
import ExtensionIcon from "@mui/icons-material/Extension";
import WebIcon from "@mui/icons-material/Web";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";

import { Breadcrumb } from "@/breadcrumb";
import HealthCheck from "./health-check";

const sections = [
  {
    title: "Organizations",
    href: "/organizations",
    description:
      "University colleges, institutes and departments — the institutional tree every site belongs to.",
    icon: BusinessIcon,
  },
  {
    title: "Sites",
    href: "/sites",
    description:
      "Public websites and microsites managed by the platform, including domains and publishing state.",
    icon: WebIcon,
  },
  {
    title: "Modules",
    href: "/modules",
    description:
      "Platform capability registry — what each site may enable, and on what terms.",
    icon: ExtensionIcon,
  },
];

export default function AdminDashboard() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Dashboard" },
          ]}
        />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Dashboard
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          University of Gondar Digital Platform — administration console.
        </Typography>
      </Box>

      <Alert severity="info" variant="outlined">
        <strong>Connected to the platform API.</strong> The sections below
        read and write through the Django API using your Keycloak session.
        The server decides every request: it enforces the platform-admin
        role, rejects stale writes, and applies the organization and site
        lifecycle rules — any refusal is shown on the screen that caused it.
      </Alert>

      <Box
        component="section"
        aria-labelledby="admin-sections-heading"
        sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
      >
        <Typography id="admin-sections-heading" variant="h6" sx={{ fontWeight: 700 }}>
          Management sections
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          }}
        >
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title} variant="outlined" sx={{ height: "100%" }}>
                <CardActionArea
                  component={NextLink}
                  href={section.href}
                  sx={{ height: "100%", p: 2.5, alignItems: "flex-start" }}
                  aria-label={`Open the ${section.title} section`}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                      }}
                    >
                      <Icon fontSize="small" />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {section.title}
                    </Typography>
                    <Chip label="Live API" size="small" color="success" variant="outlined" />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {section.description}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      mt: 2,
                      color: "primary.main",
                      fontWeight: 600,
                      fontSize: 13.5,
                    }}
                  >
                    Open {section.title.toLowerCase()}
                    <ArrowForwardIcon sx={{ fontSize: 16 }} />
                  </Box>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      </Box>

      <Box
        component="section"
        aria-labelledby="admin-diagnostics-heading"
        sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
      >
        <Typography id="admin-diagnostics-heading" variant="h6" sx={{ fontWeight: 700 }}>
          Backend connectivity
        </Typography>
        <Card variant="outlined">
          <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              Development diagnostic only — pings the public{" "}
              <Link href="/api/health/ready">health endpoint</Link> to confirm
              the reverse proxy can reach the Django API. It does not exercise
              any administration feature.
            </Typography>
            <HealthCheck />
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
