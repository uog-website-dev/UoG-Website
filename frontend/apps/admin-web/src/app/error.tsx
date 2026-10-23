"use client";

/**
 * Route-level error boundary.
 *
 * Catches render/runtime errors in the page segment below the layout, so the
 * application shell (header, navigation, footer) stays usable while the
 * administrator can retry the failed route.
 */
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Link from "next/link";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        Something went wrong
      </Typography>
      <Typography color="text.secondary">
        This screen hit an unexpected error. Your session and navigation are
        unaffected — you can retry, or return to the dashboard.
      </Typography>

      <Card variant="outlined" sx={{ width: "100%", mt: 1 }}>
        <Box sx={{ p: 3, display: "flex", gap: 2, alignItems: "flex-start" }}>
          <ErrorOutlineIcon color="error" sx={{ mt: 0.25 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {error.name || "Render error"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {error.message || "No additional detail is available."}
            </Typography>
            {error.digest && (
              <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 1 }}>
                Reference: {error.digest}
              </Typography>
            )}
          </Box>
        </Box>
      </Card>

      <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
        <Button variant="contained" onClick={reset}>
          Try again
        </Button>
        <Button variant="outlined" component={Link} href="/">
          Back to dashboard
        </Button>
      </Box>
    </Box>
  );
}
