/**
 * Adapter factories that honour the explicit API_MODE selection.
 *
 * These are the only place the console decides between the real API and the
 * local fixtures. Because `resolveApiMode` refuses `mock` in a production
 * build, a deployed integration can only ever construct the live adapter —
 * fabricated responses are structurally impossible there.
 *
 * Selection is a transport concern only: it never relaxes backend
 * authorization. The live adapter still sends the Keycloak access token and
 * the backend still enforces authentication, staff access and the
 * platform-admin role on every call.
 */
import type { ApiMode } from "./mode";

import { createLiveSitesAdapter, createMockSitesAdapter, type SitesAdapter } from "./sites";
import {
  createLiveOrganizationsAdapter,
  createMockOrganizationsAdapter,
  type OrganizationsAdapter,
} from "./organizations";
import { apiModeFromEnv } from "./mode";

export interface AdapterFactoryOptions {
  /** Base URL of the Django API (server: http://backend:8000/api). */
  baseUrl?: string;
  /** Keycloak access token; server-side only, never sent to the browser. */
  accessToken?: string;
  /** Override the fetch implementation (tests). */
  fetchFn?: typeof fetch;
  /** Force a mode instead of reading the environment (tests). */
  mode?: ApiMode;
  /** Simulated latency for the mock adapters (ms). Default 150. */
  mockLatencyMs?: number;
}

function resolve(options: AdapterFactoryOptions): ApiMode {
  return options.mode ?? apiModeFromEnv();
}

/** Build the Organizations adapter for the configured mode. */
export function createOrganizationsAdapter(
  options: AdapterFactoryOptions = {},
): OrganizationsAdapter {
  const mode = resolve(options);
  if (mode === "mock") {
    return createMockOrganizationsAdapter({ latencyMs: options.mockLatencyMs });
  }
  return createLiveOrganizationsAdapter({
    baseUrl: options.baseUrl ?? "/api",
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });
}

/** Build the Sites adapter for the configured mode. */
export function createSitesAdapter(
  options: AdapterFactoryOptions = {},
): SitesAdapter {
  const mode = resolve(options);
  if (mode === "mock") {
    return createMockSitesAdapter({ latencyMs: options.mockLatencyMs });
  }
  return createLiveSitesAdapter({
    baseUrl: options.baseUrl ?? "/api",
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });
}
