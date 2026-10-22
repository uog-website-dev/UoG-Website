/**
 * Admin dashboard — platform smoke screen.
 *
 * Server component: the identity and the platform overview come from the
 * protected Django endpoints, called with the Keycloak access token held by
 * the Auth.js session (`src/access-token.ts`) — the browser never sees that
 * token. Only the readiness probe stays client-side.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid2";
import Typography from "@mui/material/Typography";
import { ApiError, createApiClient } from "@uog/api-client";
import type { AdminOverview, Identity } from "@uog/types";

import { getAccessToken } from "@/access-token";
import { auth } from "@/auth";
import HealthCheck from "./health-check";

/** Server-side base URL: the Docker-network address of the Django API. */
const apiBaseUrl = process.env.API_BASE_URL ?? "http://backend:8000/api";

const services = [
  { name: "PostgreSQL 16", detail: "Shared application database" },
  { name: "Redis (cache + broker)", detail: "Caching and Celery task queue" },
  { name: "Celery Worker / Beat", detail: "Background and scheduled processing" },
  { name: "MinIO", detail: "platform-public / platform-private / platform-documents" },
  { name: "Keycloak", detail: "OIDC identity provider (realm: uog)" },
  { name: "Nginx", detail: "Reverse proxy and routing" },
];

interface PlatformIdentity {
  signedIn: boolean;
  identity: Identity | null;
  overview: AdminOverview | null;
  problem: string | null;
}

/**
 * Read the signed-in identity from the API — with the access token from the
 * session, server-side. Anonymous visitors never call the protected routes.
 */
async function loadPlatformIdentity(): Promise<PlatformIdentity> {
  const session = await auth();
  if (!session) {
    return { signedIn: false, identity: null, overview: null, problem: null };
  }

  const accessToken = await getAccessToken();
  const api = createApiClient({
    baseUrl: apiBaseUrl,
    accessToken: accessToken ?? undefined,
  });

  try {
    const [identity, overview] = await Promise.all([
      api.get<Identity>("/me/"),
      api.get<AdminOverview>("/admin/overview/"),
    ]);
    return { signedIn: true, identity, overview, problem: null };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    return {
      signedIn: true,
      identity: null,
      overview: null,
      problem:
        status === 401
          ? "The API rejected this session's access token — sign out and sign in again."
          : `The platform API could not be reached from the server (${status || "network error"}).`,
    };
  }
}

export default async function AdminDashboard() {
  const { signedIn, identity, overview, problem } =
    await loadPlatformIdentity();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Platform administration
        </Typography>
        <Typography color="text.secondary">
          Development dashboard for the UoG Digital Platform foundation.
        </Typography>
      </Box>

      {!signedIn && (
        <Alert severity="info">
          Sign in with your University of Gondar account to see the identity
          the platform API sees for you.
        </Alert>
      )}

      {signedIn && problem && <Alert severity="warning">{problem}</Alert>}

      {signedIn && identity && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Identity behind your access token
                </Typography>
                <Typography variant="body1">
                  {identity.name || identity.username}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {identity.email}
                </Typography>
                <Box
                  sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1.5 }}
                >
                  {identity.roles.map((role) => (
                    <Chip key={role} label={role} size="small" color="secondary" />
                  ))}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 1.5 }}
                >
                  client {identity.client_id} ·{" "}
                  {identity.is_staff ? "staff account" : "non-staff account"} ·
                  scopes {identity.scopes.join(" ") || "—"}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Platform overview
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {overview
                    ? `${overview.pages} pages (${overview.published_pages} published) · ${overview.users} platform users · requested by ${overview.requested_by}`
                    : "Overview unavailable."}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <HealthCheck />

      <Grid container spacing={2}>
        {services.map((service) => (
          <Grid key={service.name} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {service.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {service.detail}
                </Typography>
                <Chip label="platform service" size="small" sx={{ mt: 1.5 }} color="secondary" />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
