/**
 * Server-side access to the Keycloak access token carried by the Auth.js
 * session (stored there by the `jwt` callback in `auth.ts`).
 *
 * Only server components and server actions may use this: the token lives in
 * the httpOnly session cookie, encrypted with `AUTH_SECRET`, and is never
 * copied onto the session object the browser receives.
 *
 * Keycloak access tokens live 5 minutes (realm `accessTokenLifespan`), so an
 * expired token is exchanged for a fresh one through the realm's token
 * endpoint using the refresh token from the same session. Refreshing is best
 * effort: on failure `null` is returned, the API call goes out without an
 * `Authorization` header and the endpoint answers 401 (the UI then asks the
 * administrator to sign in again).
 */
import { getSessionToken } from "@/session-jwt";

/** Seconds of margin before the stored token counts as expired. */
const EXPIRY_SKEW_SECONDS = 15;

interface TokenEndpointResponse {
  access_token?: string;
}

/**
 * Non-sensitive claims read from the session's own access token, for
 * *display* decisions only (which role options a form offers in mock
 * development mode).
 *
 * The payload is decoded without verification because it is our own token
 * out of our own httpOnly session cookie — it is never accepted as an
 * authorization decision. Every call the screen makes still travels to the
 * backend, which re-derives the caller's authority from the token it
 * validates itself (see the IAM adapter's `getCallerAccess`).
 */
export interface SessionClaims {
  roles: string[];
  username: string | null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Roles and username carried by the session's access token, if present. */
export async function getSessionClaims(): Promise<SessionClaims> {
  const token = await getSessionToken();
  const accessToken =
    token && typeof token.accessToken === "string" ? token.accessToken : null;
  if (!accessToken) return { roles: [], username: null };

  const payload = decodeJwtPayload(accessToken);
  if (!payload) return { roles: [], username: null };

  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles)
    ? realmAccess.roles.filter((role): role is string => typeof role === "string")
    : [];
  const username =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : null;
  return { roles, username };
}

/**
 * The access token of the signed-in user, or `null` when nobody is signed in
 * (or no usable token can be obtained).
 */
export async function getAccessToken(): Promise<string | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const accessToken =
    typeof token.accessToken === "string" ? token.accessToken : null;
  if (!accessToken) return null;

  const expiresAt =
    typeof token.accessTokenExpires === "number" ? token.accessTokenExpires : 0;
  if (expiresAt - EXPIRY_SKEW_SECONDS > Math.floor(Date.now() / 1000)) {
    return accessToken;
  }

  const refreshToken =
    typeof token.refreshToken === "string" ? token.refreshToken : null;
  return refreshAccessToken(refreshToken);
}

/** Exchange the session's refresh token for a fresh access token. */
async function refreshAccessToken(
  refreshToken: string | null,
): Promise<string | null> {
  if (!refreshToken) return null;

  const endpoint =
    process.env.KEYCLOAK_TOKEN_URL ??
    "http://keycloak:8080/realms/uog/protocol/openid-connect/token";
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "admin-web";
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  if (!clientSecret) return null;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as TokenEndpointResponse;
    return payload.access_token ?? null;
  } catch {
    // Identity provider unreachable — treat as "no usable token".
    return null;
  }
}
