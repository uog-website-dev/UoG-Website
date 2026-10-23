"use client";

/**
 * Public home page.
 *
 * Demonstrates the full development wiring: the browser calls the Django
 * REST API through nginx (`/api`) using the shared typed api-client, and
 * renders results with the shared UoG theme components.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid2";
import Typography from "@mui/material/Typography";
import { ApiError, createApiClient } from "@uog/api-client";
import type { HealthReport, Page } from "@uog/types";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export default function HomePage() {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = createApiClient({ baseUrl: apiBaseUrl });
    // Health lives at the backend root, not under /api.
    const healthApi = createApiClient({ baseUrl: "" });
    Promise.all([api.get<{ results: Page[] }>("/pages/"), healthApi.get<HealthReport>("/health/ready")])
      .then(([pagesRes, healthRes]) => {
        setPages(pagesRes.results);
        setHealth(healthRes);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? `API error (${err.status})`
            : "Could not reach the API through this origin — open http://localhost (nginx) instead of a direct port.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Typography variant="h3" gutterBottom>
          University of Gondar
        </Typography>
        <Typography variant="h5" color="text.secondary" gutterBottom>
          Digital Platform — Public Website
        </Typography>
        <Typography>
          This application is part of the standardized UoG Digital Platform
          foundation: Next.js 15 + Material UI on the frontend, a Django REST
          API on the backend, and shared platform services (PostgreSQL,
          Redis/Celery, MinIO, Keycloak) running under Docker Compose.
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <CircularProgress size={24} />
          <Typography>Contacting the Django API via nginx…</Typography>
        </Box>
      )}

      {error && (
        <Alert severity="warning" action={<Button onClick={() => location.reload()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {health && (
        <Alert severity={health.status === "ok" ? "success" : "error"}>
          Backend readiness: <strong>{health.status}</strong> —{" "}
          {Object.entries(health.checks)
            .map(([name, check]) => `${name}: ${check.status}`)
            .join(" · ")}
        </Alert>
      )}

      {pages && (
        <Grid container spacing={2}>
          {pages.length === 0 && (
            <Grid>
              <Typography>No published pages yet — add some in the Django admin.</Typography>
            </Grid>
          )}
          {pages.map((page) => (
            <Grid key={page.id} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardContent>
                  <Typography variant="h6">{page.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    /{page.slug} · updated {new Date(page.updated_at).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
