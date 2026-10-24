/**
 * Serializable contract between the organization server actions and the
 * client screens.
 *
 * Server actions cross the React Server Component boundary, so their return
 * values are structured-cloned. `ApiError` is a class whose useful surface
 * lives on getters (`fieldErrors`, `isAuthError`), which do not survive that
 * boundary. Every action therefore returns a plain `ActionResult`: on
 * success the data plus the strong ETag the backend issued, on failure a
 * flattened `ApiErrorPayload`. The client rebuilds a real `ApiError` from
 * that payload so the shared UI components (which accept `ApiError`) render
 * unchanged.
 *
 * The access token never appears in either direction: actions read it
 * server-side from the Auth.js session and send it only as an Authorization
 * header. Nothing here logs or returns it.
 */
import { ApiError } from "@uog/api-client";
import type { ApiErrorCode } from "@uog/api-client";

/** Flattened, clone-safe representation of an `ApiError`. */
export interface ApiErrorPayload {
  status: number;
  code: string;
  message: string;
  details: unknown;
  requestId: string | null;
}

/**
 * Result of a server action. `etag` is the strong ETag from the response, so
 * a screen can chain the next conditional mutation without a re-fetch.
 */
export type ActionResult<T> =
  | { ok: true; data: T; etag?: string | null }
  | { ok: false; error: ApiErrorPayload };

/** Convert a thrown value into a clone-safe payload. Never leaks credentials. */
export function serializeApiError(cause: unknown): ApiErrorPayload {
  if (cause instanceof ApiError) {
    return {
      status: cause.status,
      code: cause.code,
      message: cause.message,
      details: cause.details,
      requestId: cause.requestId,
    };
  }
  const message =
    cause instanceof Error ? cause.message : "An unexpected error occurred.";
  return { status: 0, code: "api_error", message, details: null, requestId: null };
}

/** Rebuild a real `ApiError` from a payload so shared UI can render it. */
export function deserializeApiError(payload: ApiErrorPayload): ApiError {
  return new ApiError(payload.message, payload.status, {
    code: payload.code as ApiErrorCode,
    details: payload.details,
    requestId: payload.requestId,
  });
}

/** Discriminate a successful action result. */
export function isOk<T>(
  result: ActionResult<T>,
): result is { ok: true; data: T; etag?: string | null } {
  return result.ok;
}

/**
 * Unwrap a successful result or throw the rebuilt `ApiError`.
 *
 * Screens pass this to `useAsync`, which catches thrown `ApiError`s and
 * renders the shared error state — so a failed list load looks identical to a
 * failed detail load without each screen re-implementing the branch.
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw deserializeApiError(result.error);
}
