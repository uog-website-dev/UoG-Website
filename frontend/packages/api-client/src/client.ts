/**
 * Typed fetch wrapper for the UoG Django REST API.
 *
 * Both frontend apps import this package so API access stays consistent.
 * Pass the base URL explicitly (server-side renders should use the internal
 * Docker URL, e.g. http://backend:8000/api; browser code goes through
 * nginx, e.g. /api).
 *
 * Every request carries a correlation id:
 *   - a UUID is generated per request and sent as `X-Request-ID`, so backend
 *     logs, the response header and the error envelope all reference the same
 *     id;
 *   - the id is surfaced on `ApiError.requestId` so a screen can show the
 *     operator exactly what to quote in a support request.
 *
 * Detail responses also expose the strong `ETag` the backend requires in
 * `If-Match` for conditional mutations.
 *
 * Security: the access token is only ever sent as an `Authorization` header
 * and is never placed in a URL, an error message or a logged string. Errors
 * run through `redactCredentials` defensively (see ./errors.ts).
 */
import type { ETaggedResponse } from "@uog/types";

import { ApiError, apiErrorFromResponse, redactCredentials } from "./errors";

export { ApiError } from "./errors";
export { buildQueryString, withQuery } from "./query";
export type { QueryValue } from "./query";

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
  /**
   * Optional correlation id generator. Defaults to `crypto.randomUUID`, so
   * each request gets a fresh id that the backend echoes back.
   */
  requestIdFactory?: () => string;
}

/** Response envelope for calls that need headers (ETag, request id). */
export interface ApiResult<T> {
  data: T;
  etag: string | null;
  requestId: string | null;
  status: number;
}

export interface ApiClient {
  /** Convenience GET returning just the parsed body. */
  get<T>(path: string, init?: RequestInit): Promise<T>;
  /** GET returning the body plus ETag and correlation id. */
  getDetailed<T>(path: string, init?: RequestInit): Promise<ApiResult<T>>;
  /** Convenience POST returning just the parsed body. */
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  /** POST returning the body plus ETag and correlation id (for 201 creates). */
  postDetailed<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<ApiResult<T>>;
  /** PATCH with a required `If-Match` precondition (conditional update). */
  patchDetailed<T>(
    path: string,
    body: unknown,
    options: { ifMatch: string; init?: RequestInit },
  ): Promise<ApiResult<T>>;
  /** DELETE with a required `If-Match` precondition (conditional delete). */
  delDetailed<T>(
    path: string,
    options: { ifMatch: string; init?: RequestInit },
  ): Promise<ApiResult<T>>;
}

/** Default correlation id: a UUID, matching the backend's X-Request-ID spec. */
function defaultRequestIdFactory(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Deterministic-enough fallback for environments without WebCrypto
  // (should not occur in supported browsers or Node >= 19).
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const {
    baseUrl,
    fetchFn = fetch,
    timeoutMs = 10_000,
    accessToken,
    requestIdFactory = defaultRequestIdFactory,
  } = options;
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init?: RequestInit,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResult<T>> {
    const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const requestId = requestIdFactory();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchFn(url, {
          ...init,
          signal: init?.signal ?? controller.signal,
          headers: {
            Accept: "application/json",
            // Correlation id: the backend echoes it in X-Request-ID and in
            // every error envelope, so failures are traceable end to end.
            "X-Request-ID": requestId,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(init?.headers ?? {}),
            ...(extraHeaders ?? {}),
          },
          cache: init?.cache ?? "no-store",
        });
      } catch (cause) {
        // No HTTP response at all: network failure or timeout. Never include
        // the request headers, so the access token cannot leak into the error.
        if (cause instanceof DOMException && cause.name === "AbortError") {
          throw new ApiError(
            `Request to ${url} timed out after ${timeoutMs}ms`,
            0,
            { code: "timeout", requestId },
          );
        }
        throw new ApiError(
          `Request to ${url} could not reach the API: ${
            cause instanceof Error ? cause.message : "network error"
          }`,
          0,
          { code: "network_error", requestId },
        );
      }

      if (!response.ok) {
        throw await apiErrorFromResponse(response, requestId);
      }

      const etag = response.headers.get("ETag");
      const responseRequestId = response.headers.get("X-Request-ID") ?? requestId;

      // 204 No Content (and other empty bodies) have nothing to parse.
      if (response.status === 204) {
        return {
          data: undefined as T,
          etag,
          requestId: responseRequestId,
          status: response.status,
        };
      }

      const text = await response.text();
      let data: T;
      if (text === "") {
        data = undefined as T;
      } else {
        try {
          data = JSON.parse(text) as T;
        } catch {
          throw new ApiError(
            `Request to ${url} returned a malformed JSON response`,
            response.status,
            { code: "invalid_response", requestId: responseRequestId },
          );
        }
      }

      return { data, etag, requestId: responseRequestId, status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: <T>(path: string, init?: RequestInit) =>
      request<T>(path, init).then((result) => result.data),
    getDetailed: <T>(path: string, init?: RequestInit) => request<T>(path, init),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      }).then((result) => result.data),
    postDetailed: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      }),
    patchDetailed: <T>(
      path: string,
      body: unknown,
      { ifMatch, init }: { ifMatch: string; init?: RequestInit },
    ) =>
      request<T>(
        path,
        {
          ...init,
          method: "PATCH",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
        },
        // Conditional mutations require the exact strong ETag from GET
        // detail; the backend answers 412 when it is stale.
        { "If-Match": ifMatch },
      ),
    delDetailed: <T>(
      path: string,
      { ifMatch, init }: { ifMatch: string; init?: RequestInit },
    ) =>
      request<T>(
        path,
        {
          ...init,
          method: "DELETE",
        },
        // Revocation is a conditional delete: the exact strong ETag from
        // GET detail is required, and a stale one is answered with 412.
        { "If-Match": ifMatch },
      ),
  };
}

/** Convenience helper: turn an ApiError into a safe, displayable message. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return redactCredentials(error.message);
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
