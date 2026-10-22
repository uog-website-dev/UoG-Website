/**
 * Auth.js (NextAuth v5) configuration for the public website.
 *
 * Identity provider: Keycloak (realm `uog`, client `public-web`).
 * The client secret and issuer arrive via environment variables injected by
 * docker compose — nothing sensitive lives in source control.
 */
import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

const issuer =
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
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? "public-web",
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
     * default `session` callback below never copies this field onto the
     * session object — so browser JavaScript cannot see the token. Server
     * components and server actions read it back with `getToken` from
     * `next-auth/jwt` when they call the Django API (see
     * `apps/admin-web/src/access-token.ts` for the shared pattern).
     */
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.accessTokenExpires = account.expires_at ?? null;
        token.refreshToken = account.refresh_token ?? null;
      }
      return token;
    },
    /**
     * Default Auth.js behaviour rejects a redirect target on a different
     * origin than the one it sees on the server. Here the server-side origin
     * is the container port, while the visitor enters through nginx, so the
     * platform origin is allowed explicitly — and only that one.
     */
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url === siteOrigin || url.startsWith(`${siteOrigin}/`)) return url;
      return baseUrl;
    },
  },
});
