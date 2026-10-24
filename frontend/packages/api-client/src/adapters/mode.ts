/**
 * Explicit selection between the live API and local mocks.
 *
 * The console must never present fabricated data as real, so the choice is
 * explicit and enforced:
 *
 *   - `API_MODE=mock`   -> local fixtures (development only)
 *   - `API_MODE=live`   -> the real Django API
 *   - unset             -> `live` in production, `mock` in development
 *
 * In a production build (`NODE_ENV=production`) the mock is refused
 * outright: a deployed integration cannot be configured to serve fixtures,
 * which is the acceptance criterion "no fabricated API response is used in
 * deployed integration mode".
 *
 * This is a *transport* choice only. It does not bypass any backend
 * authorization: the live adapter still sends the Keycloak access token and
 * the backend still enforces authentication, staff access and the
 * platform-admin role. Nothing here relaxes server-side validation.
 */
import { ApiError } from "../client";

export type ApiMode = "live" | "mock";

export interface ResolveModeOptions {
  /** Value of API_MODE (or NEXT_PUBLIC_API_MODE) from the environment. */
  configured?: string | undefined;
  /** Whether this is a production build. Defaults to NODE_ENV. */
  isProduction?: boolean;
}

export class ApiModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiModeError";
  }
}

/**
 * Resolve the API mode, throwing on an unusable configuration.
 *
 * Throws `ApiModeError` when the configured value is neither `live` nor
 * `mock`, or when `mock` is requested in a production build. Callers should
 * let the error surface rather than silently falling back, so a misconfigured
 * deployment fails loudly instead of serving the wrong data.
 */
export function resolveApiMode(options: ResolveModeOptions = {}): ApiMode {
  const isProduction =
    options.isProduction ?? process.env.NODE_ENV === "production";
  const raw = options.configured?.trim().toLowerCase();

  if (raw === undefined || raw === "") {
    // Explicit default: production is always live; development favours the
    // mock so the UI can be built without a running backend.
    return isProduction ? "live" : "mock";
  }

  if (raw === "live") return "live";

  if (raw === "mock") {
    if (isProduction) {
      throw new ApiModeError(
        "API_MODE=mock is not allowed in a production build. The console " +
          "must not serve fabricated data in a deployed integration. " +
          "Set API_MODE=live (or unset it) and configure the real backend.",
      );
    }
    return "mock";
  }

  throw new ApiModeError(
    `Invalid API_MODE "${options.configured}". Expected "live" or "mock".`,
  );
}

/**
 * Read the mode from the process environment. Next.js inlines
 * NEXT_PUBLIC_* at build time, so the browser bundle reads that name while
 * server code can use either.
 */
export function apiModeFromEnv(isProduction?: boolean): ApiMode {
  return resolveApiMode({
    configured: process.env.API_MODE ?? process.env.NEXT_PUBLIC_API_MODE,
    isProduction,
  });
}

/**
 * Type guard for the transport errors the adapters raise. Useful for screens
 * that must distinguish "backend said no" from "backend not implemented".
 */
export function isNotImplemented(error: unknown): boolean {
  return error instanceof ApiError && error.status === 501;
}
