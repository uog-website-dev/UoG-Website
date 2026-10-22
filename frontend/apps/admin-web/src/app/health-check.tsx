"use client";

/**
 * Backend readiness probe.
 *
 * The dashboard renders server-side, but this check has to run in the
 * browser: it proves the *visitor's* origin can reach the Django API through
 * nginx (the server-side calls go over the Docker network instead).
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { createApiClient } from "@uog/api-client";
import type { HealthReport } from "@uog/types";

export default function HealthCheck() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Health lives at the backend root, not under /api.
    const healthApi = createApiClient({ baseUrl: "" });
    healthApi
      .get<HealthReport>("/health/ready")
      .then(setHealth)
      .catch(() =>
        setError(
          "Could not reach the API through this origin — open http://localhost/admin (nginx) instead of a direct port.",
        ),
      );
  }, []);

  if (error) {
    return <Alert severity="warning">{error}</Alert>;
  }

  if (!health) {
    return (
      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <CircularProgress size={24} />
        <Typography>Checking backend readiness…</Typography>
      </Box>
    );
  }

  return (
    <Alert severity={health.status === "ok" ? "success" : "error"}>
      Django API readiness: <strong>{health.status}</strong>
    </Alert>
  );
}
