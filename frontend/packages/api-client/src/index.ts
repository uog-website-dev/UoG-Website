/**
 * Typed fetch wrapper for the UoG Django REST API.
 *
 * Both frontend apps import this package so API access stays consistent.
 * Pass the base URL explicitly (server-side renders should use the internal
 * Docker URL, e.g. http://backend:8000/api; browser code goes through
 * nginx, e.g. /api).
 */
import type { HealthReport, Page, PaginatedResponse } from "@uog/types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  /**
   * Keycloak access token sent as `Authorization: Bearer …` on every
   * request. It stays server-side: only server components / server actions
   * should construct a client with it (the browser never holds the token).
   */
  accessToken?: string;
  /** Optional request timeout in milliseconds (browser/undici fetch only). */
  timeoutMs?: number;
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, fetchFn = fetch, timeoutMs = 10_000, accessToken } = options;
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init?.headers ?? {}),
        },
        cache: init?.cache ?? "no-store",
      });
      if (!response.ok) {
        throw new ApiError(
          `Request to ${url} failed with HTTP ${response.status}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      }),
  };
}

/** Convenience helpers for the platform's sample resources. */
export function fetchPages(client: ApiClient): Promise<PaginatedResponse<Page>> {
  return client.get<PaginatedResponse<Page>>("/pages/");
}

export function fetchHealth(client: ApiClient): Promise<HealthReport> {
  // Health lives under /health/ on the backend root, not under /api.
  return client.get<HealthReport>("/health/ready");
}
