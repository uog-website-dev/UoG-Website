"use client";

/**
 * Public home page.
 *
 * Demonstrates the full development wiring: the browser calls the Django
 * REST API through nginx (`/api`) and renders the host-resolved published
 * homepage. Draft, rejected and unpublished Pages are not shown.
 *
 * The browser's Host header is preserved by nginx (`proxy_set_header Host
 * $host`), so `GET /api/v1/site-context/` reports exactly which Site the
 * backend resolved from this request's hostname — the end-to-end proof that
 * domain-based routing works through the approved Nginx setup. A platform
 * host (localhost/127.0.0.1) resolves to no Site and says so; an unknown or
 * inactive hostname is rejected by the backend before this view, so nothing
 * here can reveal another Site.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { ApiError, createApiClient } from "@uog/api-client";
import { pageFromResponse, PublicPageView } from "@uog/ui";
import type { PublicPageDocument } from "@uog/ui";
import type { HealthReport } from "@uog/types";

const PUBLIC_HOMEPAGE_PATH = "/api/v1/site-context/homepage/";

/** Shape of `GET /api/v1/site-context/` (see apps/sites/api/context.py). */
interface SiteContext {
  site: {
    id: number;
    code: string;
    name: string;
    organization_unit: number;
  } | null;
  domain: string | null;
  configuration: {
    display_name: string | null;
    theme: string;
  } | null;
  modules: string[];
}

export default function HomePage() {
  const [homepage, setHomepage] = useState<PublicPageDocument | null>(null);
  const [homepageReady, setHomepageReady] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [siteContext, setSiteContext] = useState<SiteContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Health lives at the backend root, not under /api.
    const healthApi = createApiClient({ baseUrl: "" });
    // Site routing context: resolved from the browser's Host header.
    const contextApi = createApiClient({ baseUrl: "/api/v1" });
    Promise.all([
      fetch(PUBLIC_HOMEPAGE_PATH, { headers: { Accept: "application/json" }, cache: "no-store" })
        .then(async (response) => {
          const body = response.ok ? await response.json().catch(() => null) : null;
          return pageFromResponse(response.status, body);
        })
        .catch(() => null),
      healthApi.get<HealthReport>("/health/ready"),
      contextApi.get<SiteContext>("/site-context/").catch((err: unknown) => {
        // Routing context is auxiliary to the page demo; state the failure
        // instead of blocking the page or guessing a Site.
        setContextError(
          err instanceof ApiError
            ? `Site context unavailable (${err.status})`
            : "Site context unavailable",
        );
        return null;
      }),
    ])
      .then(([homepageRes, healthRes, contextRes]) => {
        setHomepage(homepageRes);
        setHomepageReady(true);
        setHealth(healthRes);
        setSiteContext(contextRes);
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

      {/* Hostname-based Site resolution, as the backend resolved it for this
          request's Host — never guessed client-side. */}
      {siteContext ? (
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Site resolved from this host
              </Typography>
              {siteContext.site ? (
                <Chip size="small" color="success" variant="outlined" label="Resolved" />
              ) : (
                <Chip size="small" variant="outlined" label="Platform host" />
              )}
            </Box>
            {siteContext.site ? (
              <>
                <Typography variant="body2">
                  Associated Site: <strong>{siteContext.site.name}</strong>{" "}
                  (<Box component="span" sx={{ fontFamily: "monospace" }}>{siteContext.site.code}</Box>, Site&nbsp;#{siteContext.site.id})
                </Typography>
                {siteContext.domain ? (
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    Domain: {siteContext.domain}
                  </Typography>
                ) : null}
                {siteContext.configuration?.display_name ? (
                  <Typography variant="body2" color="text.secondary">
                    Display name: {siteContext.configuration.display_name}
                  </Typography>
                ) : null}
                {siteContext.modules.length > 0 ? (
                  <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                    {siteContext.modules.map((code) => (
                      <Chip
                        key={code}
                        size="small"
                        variant="outlined"
                        color="primary"
                        label={code.toLowerCase()}
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    No modules are enabled on this Site yet.
                  </Typography>
                )}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                This is a platform host (no institutional hostname is configured),
                so the backend resolved no Site. Configure a SITE domain and open
                it through its hostname to see routing take effect.
              </Typography>
            )}
          </CardContent>
        </Card>
      ) : contextError ? (
        <Alert severity="warning" variant="outlined">
          {contextError} — no Site is guessed in its place.
        </Alert>
      ) : null}

      {health && (
        <Alert severity={health.status === "ok" ? "success" : "error"}>
          Backend readiness: <strong>{health.status}</strong> —{" "}
          {Object.entries(health.checks)
            .map(([name, check]) => `${name}: ${check.status}`)
            .join(" · ")}
        </Alert>
      )}

      {homepageReady ? <PublicPageView page={homepage} /> : null}
    </Box>
  );
}
