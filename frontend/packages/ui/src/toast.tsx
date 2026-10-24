"use client";

/**
 * Shared toast notifications for admin screens.
 *
 * Actions that succeed or fail out of sight (a lifecycle transition behind a
 * confirm dialog, an applied filter) need visible feedback. `ToastProvider`
 * wraps an app and exposes `useToast()`, so any screen can announce a result
 * without each one owning its own snackbar state.
 *
 * Accessibility: the snackbar region is a polite live region, so messages are
 * announced without stealing focus, and every toast can be dismissed with
 * the keyboard via its close button.
 */
import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import type { AlertColor } from "@mui/material/Alert";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

export interface ToastOptions {
  /** Severity maps to the Alert tone. */
  severity?: AlertColor;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  durationMs?: number;
  /** Optional action button rendered inside the alert. */
  action?: ReactNode;
}

interface ToastRecord extends ToastOptions {
  id: number;
  message: string;
}

export interface ToastApi {
  /** Show a toast. Returns nothing; the provider owns the queue. */
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  /** Dismiss the currently visible toast. */
  close: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastRecord | null>(null);
  const nextId = useRef(1);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    setCurrent({ id: nextId.current++, message, ...options });
  }, []);

  const close = useCallback(() => setCurrent(null), []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, options) => show(message, { ...options, severity: "success" }),
      error: (message, options) => show(message, { ...options, severity: "error" }),
      info: (message, options) => show(message, { ...options, severity: "info" }),
      warning: (message, options) => show(message, { ...options, severity: "warning" }),
      close,
    }),
    [show, close],
  );

  const severity = current?.severity ?? "info";
  const duration = current?.durationMs ?? DEFAULT_DURATION_MS;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={current !== null}
        autoHideDuration={duration > 0 ? duration : null}
        onClose={(_event, reason) => {
          // Ignore "clickaway": a toast raised by clicking a button outside
          // the snackbar must not be dismissed by that same click. Without
          // this, showing a second toast while one is open would immediately
          // close it (React's handler runs first, then the clickaway listener
          // nulls the state).
          if (reason === "clickaway") return;
          close();
        }}
        // Anchor low and central so toasts never cover the header actions.
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        // The Alert is the live region; keep the Snackbar wrapper silent so
        // the message is not announced twice.
        aria-live="off"
      >
        <Alert
          severity={severity}
          variant="filled"
          onClose={close}
          action={
            current?.action ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {current.action}
              </Box>
            ) : (
              <IconButton
                aria-label="Dismiss notification"
                color="inherit"
                size="small"
                onClick={close}
              >
                <CloseIcon fontSize="inherit" />
              </IconButton>
            )
          }
          sx={{ minWidth: 280 }}
        >
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

/**
 * Access the toast API.
 *
 * Must be used inside a `ToastProvider`; throws a clear error otherwise so a
 * missing provider fails loudly at development time.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used within a <ToastProvider>.");
  }
  return api;
}
