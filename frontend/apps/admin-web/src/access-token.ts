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
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";

/** Seconds of margin before the stored token counts as expired. */
const EXPIRY_SKEW_SECONDS = 15;

interface TokenEndpointResponse {
  access_token?: string;
}

/**
 * The access token of the signed-in user, or `null` when nobody is signed in
 * (or no usable token can be obtained).
 */
export async function getAccessToken(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  // Auth.js switches to the `__Secure-` cookie — and salts the session JWT
  // with that name — on https origins, so decode whichever one is present.
  const cookieStore = await cookies();
  const secure = cookieStore.has("__Secure-authjs.session-token");

  const token = await getToken({
    req: { headers: await headers() },
    secret,
    secureCookie: secure,
  });
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
