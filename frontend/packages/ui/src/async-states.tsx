"use client";

/**
 * Shared async screen states: loading, empty and error.
 *
 * Every admin list/detail screen renders one of these three states around
 * its content, so the console behaves consistently: the same spinner, the
 * same honest empty message, and the same error presentation (including the
 * backend correlation id an operator can quote in a support request).
 *
 * Accessibility: each state announces itself to assistive technology.
 * Loading uses `role="status"`, errors use `role="alert"`, and every state
 * is reachable and actionable by keyboard.
 */
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InboxIcon from "@mui/icons-material/Inbox";
import RefreshIcon from "@mui/icons-material/Refresh";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

import { ApiError } from "@uog/api-client";

/** Loading state: a labelled progress indicator. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-busy="true"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        py: { xs: 6, sm: 8 },
      }}
    >
      <CircularProgress size={40} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

/** Empty state: explains that there is nothing to show, and why. */
export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        py: { xs: 6, sm: 8 },
        px: 3,
        textAlign: "center",
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: 2,
          bgcolor: "action.hover",
          color: "text.disabled",
        }}
      >
        <InboxIcon fontSize="large" />
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  );
}

/**
 * Error state: a safe, human message plus the correlation id, with an
 * optional retry action.
 *
 * The message never contains credentials — `ApiError` redacts bearer tokens
 * when it is constructed (see @uog/api-client), so it is safe to render.
 */
export function ApiErrorState({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error: ApiError;
  onRetry?: () => void;
  title?: string;
}) {
  const isAuth = error.isAuthError;
  const isUnavailable = error.status === 501;

  const heading = isAuth
    ? "Sign-in required"
    : isUnavailable
      ? "Not available yet"
      : title;

  const guidance = isAuth
    ? "Your session has expired or you are not signed in. Sign in again to continue."
    : isUnavailable
      ? "This feature is not connected in this environment. No data is shown because none is available."
      : error.message;

  return (
    <Box
      role="alert"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        py: { xs: 5, sm: 7 },
        px: 3,
        textAlign: "center",
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: 2,
          bgcolor: "error.light",
          color: "error.contrastText",
          opacity: 0.9,
        }}
      >
        <ErrorOutlineIcon fontSize="large" />
      </Box>

      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {heading}
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        {guidance}
      </Typography>

      {error.requestId ? (
        <Chip
          size="small"
          variant="outlined"
          color="default"
          label={`Reference: ${error.requestId}`}
          aria-label={`Support reference number ${error.requestId}`}
          sx={{ fontFamily: "monospace" }}
        />
      ) : null}

      {onRetry ? (
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          sx={{ mt: 1 }}
        >
          Try again
        </Button>
      ) : null}
    </Box>
  );
}
