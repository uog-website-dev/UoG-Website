/**
 * Typed transport-level errors for the UoG API client.
 *
 * Every failure the client can produce — HTTP errors, network failures and
 * timeouts — is surfaced as an `ApiError` carrying the backend's structured
 * envelope (`{error:{code,message,details},request_id}`) when available, so
 * screens can render a useful message, a correlation id for support, and
 * per-field validation errors without string-matching messages.
 *
 * Security: an `ApiError` never carries credentials. The client redacts any
 * bearer token or authorization header from messages and details before
 * constructing the error (see `redactCredentials`), so an error object can be
 * logged or rendered without leaking the Keycloak access token.
 */
import type { ApiErrorBody } from "@uog/types";

/** Error codes the backend can return, plus client-side transport codes. */
export type ApiErrorCode =
  | "validation_error"
  | "not_authenticated"
  | "permission_denied"
  | "not_found"
  | "method_not_allowed"
  | "not_acceptable"
  | "conflict"
  | "precondition_failed"
  | "precondition_required"
  | "unsupported_media_type"
  | "throttled"
  | "service_unavailable"
  | "not_implemented"
  | "api_error"
  // Client-side transport failures (no HTTP response).
  | "network_error"
  | "timeout"
  | "invalid_response";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Per-field validation messages, when the backend sent them. */
  readonly details: unknown;
  /** Backend correlation id (request_id / X-Request-ID) for support. */
  readonly requestId: string | null;

  constructor(
    message: string,
    status: number,
    options: {
      code?: ApiErrorCode;
      details?: unknown;
      requestId?: string | null;
    } = {},
  ) {
    super(redactCredentials(message));
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? "api_error";
    this.details = redactCredentials(options.details);
    this.requestId = options.requestId ?? null;
  }

  /** True when the failure is a 401 — the caller must re-authenticate. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** True when the failure is a client-side transport error (no response). */
  get isTransportError(): boolean {
    return this.code === "network_error" || this.code === "timeout";
  }

  /**
   * Normalise anything thrown into an `ApiError`.
   *
   * Adapters, hooks and screens call this so a non-API failure (a bug, a
   * rejected promise from a mock) is still surfaced through the one error
   * type the UI knows how to render, without ever leaking its raw payload.
   */
  static fromUnknown(cause: unknown): ApiError {
    if (cause instanceof ApiError) return cause;
    const message =
      cause instanceof Error ? cause.message : "An unexpected error occurred.";
    return new ApiError(message, 0, { code: "api_error" });
  }

  /**
   * Per-field validation errors as a plain map, or null when the failure was
   * not a 400 with field details. DRF sends `{field: [messages]}`; anything
   * else is returned under `non_field_errors` by the backend.
   */
  get fieldErrors(): Record<string, string[]> | null {
    if (this.status !== 400 || this.details === null || this.details === undefined) {
      return null;
    }
    const details = this.details as Record<string, unknown>;
    if (typeof details !== "object" || Array.isArray(details)) return null;
    const result: Record<string, string[]> = {};
    for (const [field, value] of Object.entries(details)) {
      if (Array.isArray(value)) {
        result[field] = value.map((message) => String(message));
      } else if (typeof value === "string") {
        result[field] = [value];
      } else if (value !== null && typeof value === "object") {
        // DRF nested serializers send dicts of lists.
        for (const [nested, nestedValue] of Object.entries(value)) {
          if (Array.isArray(nestedValue)) {
            result[`${field}.${nested}`] = nestedValue.map((message) =>
              String(message),
            );
          }
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }
}

/**
 * Remove bearer tokens and Authorization header values from a string, or
 * from any nested structure (used for error details).
 *
 * The Django API echoes query parameters back in validation details, and a
 * malformed URL could therefore put a token into an error message. Strip the
 * value rather than trusting every upstream response to be well-behaved.
 *
 * Two defences, because details can arrive both as free text and as a
 * structured object:
 *
 *   1. inside any string, a bearer token or `*_token=…` parameter is
 *      replaced with `[redacted]`; and
 *   2. any *value* whose key names a credential (`token`, `secret`,
 *      `password`, `authorization`, …) is replaced outright, so a structured
 *      `{refresh_token: "…"}` cannot leak even though the value itself has
 *      no recognisable token pattern.
 */
export function redactCredentials<T>(value: T, keyHint?: string): T {
  if (typeof value === "string") {
    // A credential-named key redacts its whole value, not just token-shaped
    // substrings (e.g. an opaque session string with no `Bearer` prefix).
    if (keyHint && SENSITIVE_KEY.test(keyHint)) {
      return "[redacted]" as unknown as T;
    }
    return redactString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentials(item, keyHint)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = redactCredentials(item, key);
    }
    return result as unknown as T;
  }
  return value;
}

/** Key names whose values are always treated as credentials. */
const SENSITIVE_KEY =
  /(?:^|[_.-])(token|secret|password|passwd|pwd|authorization|auth|credential|apikey|api_key|private_key|client_secret)$/i;

/** Redact a bearer token or authorization header value inside a string. */
function redactString(input: string): string {
  return input
    // Authorization: Bearer <token>
    .replace(/(authorization["']?\s*[:=]\s*["']?)bearer\s+[^\s"',;]+/gi, "$1[redacted]")
    .replace(/bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    // Access/refresh/id token query or body parameters.
    .replace(
      /\b((?:access|refresh|id)_token)(=["']?)[^&\s"',}]+/gi,
      "$1$2[redacted]",
    );
}

/**
 * Map a failed HTTP response into an `ApiError`, parsing the backend's
 * structured envelope when present and falling back to the status code.
 */
export async function apiErrorFromResponse(
  response: Response,
  requestId: string | null,
): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }

  const envelope = body as { error?: ApiErrorBody; request_id?: string } | null;
  const backendCode = envelope?.error?.code;
  const backendMessage = envelope?.error?.message;
  const backendRequestId = envelope?.request_id ?? requestId;

  const code = isKnownCode(backendCode) ? backendCode : codeForStatus(response.status);
  const message =
    backendMessage ??
    `Request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;

  return new ApiError(message, response.status, {
    code,
    details: envelope?.error?.details,
    requestId: backendRequestId,
  });
}

function isKnownCode(code: unknown): code is ApiErrorCode {
  return (
    typeof code === "string" &&
    [
      "validation_error",
      "not_authenticated",
      "permission_denied",
      "not_found",
      "method_not_allowed",
      "not_acceptable",
      "conflict",
      "precondition_failed",
      "precondition_required",
      "unsupported_media_type",
      "throttled",
      "service_unavailable",
      "api_error",
    ].includes(code)
  );
}

/** Best-effort mapping from an HTTP status to the backend's error code. */
export function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "validation_error";
    case 401:
      return "not_authenticated";
    case 403:
      return "permission_denied";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 406:
      return "not_acceptable";
    case 409:
      return "conflict";
    case 412:
      return "precondition_failed";
    case 415:
      return "unsupported_media_type";
    case 428:
      return "precondition_required";
    case 429:
      return "throttled";
    case 503:
      return "service_unavailable";
    default:
      return "api_error";
  }
}
