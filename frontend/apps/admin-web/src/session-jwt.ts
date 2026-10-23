/**
 * Server-side access to the raw Auth.js session JWT.
 *
 * The token lives in the httpOnly session cookie, encrypted with AUTH_SECRET,
 * and is never copied onto the session object the browser receives. Server
 * components and actions use this to read the fields stored by the `jwt`
 * callback in `auth.ts` (Keycloak access/refresh/id tokens).
 */
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";

export async function getSessionToken() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  // Auth.js switches to the `__Secure-` cookie — and salts the session JWT
  // with that name — on https origins, so decode whichever one is present.
  const cookieStore = await cookies();
  const secure = cookieStore.has("__Secure-authjs.session-token");

  return getToken({
    req: { headers: await headers() },
    secret,
    secureCookie: secure,
  });
}
