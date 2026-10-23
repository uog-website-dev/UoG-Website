/**
 * Auth.js (NextAuth v5) configuration for the admin console.
 *
 * Identity provider: Keycloak (realm `uog`, client `admin-web`).
 * Because admin-web is served under the /admin base path, AUTH_URL must
 * include that prefix (see docker-compose.yml).
 */
import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

import { APP_BASE_PATH } from "@/base-path";

export const issuer =
  process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/uog";

/**
 * The platform entry point the browser uses (nginx on port 80).
 *
 * Auth.js runs in-process, so it never calls itself over the network — but
 * it derives the OAuth redirect URI from the origin it is configured with.
 * That URI has to be the one the browser can reach, hence the platform
 * origin is used both here and for AUTH_URL (see docker-compose.yml).
 */
export const siteOrigin = process.env.SITE_ORIGIN ?? "http://localhost";

/**
 * The admin console is served under the Next.js basePath `/admin`, which
 * also prefixes the route handler — the Auth.js endpoints therefore live at
 * `/admin/api/auth/*`, not at the default `/api/auth/*`. The base path has
 * to contain the prefix because Auth.js appends `/callback/<provider>` to it
 * when it builds the OAuth redirect URI. The route handler restores the
 * prefix that Next.js strips (see `app/api/auth/[...nextauth]/route.ts`).
 */
const authBasePath = `${APP_BASE_PATH}/api/auth`;

// Keycloak is reached on two hosts: the browser uses the published port
// (localhost:8080) while the Node process uses the `keycloak` service on the
// Docker network. Keycloak advertises the public issuer and answers backchannel
// requests on the host they arrive on, so the issuer stays the one the browser
// sees (Auth.js compares it with the "iss" claim of the tokens) and only the
// server-side endpoints need the internal address.
const authorizationUrl = process.env.KEYCLOAK_AUTH_URL;
const tokenUrl = process.env.KEYCLOAK_TOKEN_URL;
const userinfoUrl = process.env.KEYCLOAK_USERINFO_URL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: authBasePath,
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? "admin-web",
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer,
      ...(authorizationUrl
        ? {
            authorization: {
              url: authorizationUrl,
              params: { scope: "openid email profile" },
            },
          }
        : {}),
      ...(tokenUrl ? { token: { url: tokenUrl } } : {}),
      ...(userinfoUrl ? { userinfo: { url: userinfoUrl } } : {}),
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  callbacks: {
    /**
     * Keep the Keycloak access token inside the Auth.js session JWT.
     *
     * The session cookie is httpOnly and encrypted with AUTH_SECRET, and the
     * default `session` callback never copies this field onto the session
     * object — so browser JavaScript cannot see the token. Server components
     * and server actions read it back with `getToken` from `next-auth/jwt`
     * (see `src/access-token.ts`) when they call the Django API.
     */
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.accessTokenExpires = account.expires_at ?? null;
        token.refreshToken = account.refresh_token ?? null;
        // Needed for RP-initiated logout at Keycloak (see src/app/actions.ts).
        token.idToken = account.id_token ?? null;
      }
      return token;
    },
    /**
     * Default Auth.js behaviour rejects a redirect target on a different
     * origin than the one it sees on the server. Here the server-side origin
     * is the container port, while the administrator enters through nginx, so
     * the platform origin is allowed explicitly — and only that one.
     */
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url === siteOrigin || url.startsWith(`${siteOrigin}/`)) return url;
      return baseUrl;
    },
  },
});
