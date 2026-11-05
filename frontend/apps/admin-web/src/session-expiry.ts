/**
 * Where an expired admin session is sent: a route that clears the local
 * session and starts a new Keycloak sign-in, then returns to `returnTo`.
 */
import { APP_BASE_PATH } from "@/base-path";

export const SESSION_EXPIRED_PATH = `${APP_BASE_PATH}/api/session/expired`;

/**
 * The console path to come back to after signing in again, or the console
 * home. Only same-origin paths under the base path are accepted, so the
 * route cannot be used to send someone to another site.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.includes("\\") || value.startsWith("//")) return `${APP_BASE_PATH}/`;
  if (value !== APP_BASE_PATH && !value.startsWith(`${APP_BASE_PATH}/`)) return `${APP_BASE_PATH}/`;
  if (value.startsWith(`${APP_BASE_PATH}/api/`)) return `${APP_BASE_PATH}/`;
  return value;
}

export function sessionExpiredHref(returnTo?: string): string {
  if (!returnTo) return SESSION_EXPIRED_PATH;
  return `${SESSION_EXPIRED_PATH}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** Leave the current page for a fresh sign-in, keeping where the user was. */
export function redirectToSignIn(): void {
  const { pathname, search } = window.location;
  window.location.assign(sessionExpiredHref(`${pathname}${search}`));
}
