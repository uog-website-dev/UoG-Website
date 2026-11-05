/**
 * Server-side access to the raw Auth.js session JWT.
 *
 * The token lives in the httpOnly session cookie, encrypted with AUTH_SECRET,
 * and is never copied onto the session object the browser receives. Server
 * components and actions use this to read the fields stored by the `jwt`
 * callback in `auth.ts` (Keycloak access/refresh/id tokens).
 */
import { cookies, headers } from "next/headers";
import { encode, getToken } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";

export async function getSessionToken() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  // Auth.js switches to the `__Secure-` cookie — and salts the session JWT
  // with that name — on https origins, so decode whichever one is present.
  const cookieStore = await cookies();
  const secure =
    cookieStore.has("__Secure-authjs.session-token") ||
    cookieStore
      .getAll()
      .some((cookie) => cookie.name.startsWith("__Secure-authjs.session-token."));

  return getToken({
    req: { headers: await headers() },
    secret,
    secureCookie: secure,
  });
}

/** Auth.js splits a session cookie that would exceed the browser's limit. */
const SESSION_COOKIE_CHUNK = 4096 - 160;

/**
 * Replace the session cookie with an updated JWT.
 *
 * A Keycloak refresh returns a new access token and, when rotation is on, a
 * new refresh token. Leaving the previous cookie in place makes the next
 * request present a token Keycloak has already retired, so the console still
 * shows the signed-in header while every API call is refused.
 *
 * Cookie writes are only allowed from a Server Action or Route Handler. A
 * caller in a Server Component still receives the fresh token for this
 * request; the write is skipped rather than failing that render.
 */
export async function writeSessionToken(token: JWT): Promise<void> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return;

  try {
    const jar = await cookies();
    const secure =
      jar.has("__Secure-authjs.session-token") ||
      jar.getAll().some((cookie) => cookie.name.startsWith("__Secure-authjs.session-token."));
    const name = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
    const value = await encode({ token, secret, salt: name });
    const chunks: { name: string; value: string }[] = [];
    if (value.length <= SESSION_COOKIE_CHUNK) {
      chunks.push({ name, value });
    } else {
      const count = Math.ceil(value.length / SESSION_COOKIE_CHUNK);
      for (let index = 0; index < count; index += 1) {
        chunks.push({
          name: `${name}.${index}`,
          value: value.slice(index * SESSION_COOKIE_CHUNK, (index + 1) * SESSION_COOKIE_CHUNK),
        });
      }
    }

    const options = { httpOnly: true, sameSite: "lax" as const, path: "/", secure };
    const nextNames = new Set(chunks.map((chunk) => chunk.name));
    for (const existing of jar.getAll()) {
      const replaced =
        existing.name === name || existing.name.startsWith(`${name}.`);
      if (replaced && !nextNames.has(existing.name)) {
        jar.set(existing.name, "", { ...options, maxAge: 0 });
      }
    }
    for (const chunk of chunks) jar.set(chunk.name, chunk.value, options);
  } catch {
    // Server Components cannot set cookies. The fresh token is still used
    // for this request, and the next Server Action writes the cookie.
  }
}
