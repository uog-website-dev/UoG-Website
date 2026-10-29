// @vitest-environment node
/**
 * Route-level tests for the admin console's OIDC sign-in.
 *
 * They drive the real Auth.js route handler against a fake Keycloak
 * authorization endpoint (no network access), which is what proves the
 * acceptance criteria for the flow itself: the authorization-code request
 * carries PKCE (S256), state and nonce, only allowlisted redirect URIs are
 * used, a sign-in POST without a CSRF token is refused, and a callback whose
 * state does not match the session never establishes a session.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const AUTH_BASE = "http://localhost/admin/api/auth";
const ISSUER = "https://idp.test/realms/uog";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/protocol/openid-connect/auth`;

/** The discovery document a real Keycloak realm would publish. */
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: AUTHORIZATION_ENDPOINT,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  userinfo_endpoint: `${ISSUER}/protocol/openid-connect/userinfo`,
  jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
  end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code", "refresh_token"],
};

let handlers: (typeof import("@/auth"))["handlers"];
let redirect: (typeof import("@/auth"))["redirect"];

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-32-characters-long";
  process.env.KEYCLOAK_CLIENT_ID = "admin-web";
  process.env.KEYCLOAK_CLIENT_SECRET = "admin-web-test-secret";
  process.env.KEYCLOAK_ISSUER = ISSUER;
  process.env.KEYCLOAK_AUTH_URL = AUTHORIZATION_ENDPOINT;
  process.env.SITE_ORIGIN = "http://localhost";

  // Every network call is answered in-process: discovery for the fake realm,
  // and a loud failure for anything else, so a test can never silently reach
  // a real identity provider.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(DISCOVERY), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected network call in test: ${url}`);
    }),
  );

  ({ handlers, redirect } = await import("@/auth"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** All Set-Cookie values of a response, as separate strings. */
function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
}

/** The request Cookie header assembled from a response's Set-Cookie values. */
function cookieHeader(response: Response): string {
  return setCookies(response)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/**
 * Auth.js reads NextRequest.nextUrl while preparing the request, so tests use
 * the same request implementation as the route instead of a plain Request.
 */
type AuthRequest = Parameters<typeof handlers.GET>[0];

function authRequest(input: Request): AuthRequest {
  return new NextRequest(input) as AuthRequest;
}

/** POST /admin/api/auth/csrf → the token plus its cookie. */
async function csrf(): Promise<{ token: string; cookie: string }> {
  const response = await handlers.GET(authRequest(new Request(`${AUTH_BASE}/csrf`)));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return { token: body.csrfToken, cookie: cookieHeader(response) };
}

/**
 * POST /admin/api/auth/signin/keycloak, pairing the CSRF token with the
 * cookie Auth.js issued for it (a token without its cookie is rejected).
 */
async function postSignIn(options: { csrf?: boolean } = {}): Promise<Response> {
  const step = await csrf();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (options.csrf !== false) headers.cookie = step.cookie;
  const body = new URLSearchParams({
    ...(options.csrf !== false ? { csrfToken: step.token } : {}),
    callbackUrl: "http://localhost/admin",
  });
  return handlers.POST(
    authRequest(
      new Request(`${AUTH_BASE}/signin/keycloak`, {
        method: "POST",
        headers,
        body: body.toString(),
      }),
    ),
  );
}

describe("OIDC authorization-code sign-in", () => {
  it("redirects to Keycloak with PKCE, state, nonce and an allowlisted redirect URI", async () => {
    const response = await postSignIn();

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);

    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const authorizationUrl = new URL(location as string);
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
      AUTHORIZATION_ENDPOINT,
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("admin-web");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/admin/api/auth/callback/keycloak",
    );
    expect(authorizationUrl.searchParams.get("scope")).toContain("openid");

    // PKCE: an S256 challenge travels in the request, while the verifier is
    // kept in an encrypted, httpOnly cookie and never appears in the URL.
    const challenge = authorizationUrl.searchParams.get("code_challenge");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(challenge).toMatch(/^[A-Za-z0-9\-._~]+$/);
    const verifierCookie = setCookies(response).find((cookie) =>
      cookie.startsWith("authjs.pkce.code_verifier="),
    );
    expect(verifierCookie).toBeTruthy();
    expect(verifierCookie).toContain("HttpOnly");
    expect(authorizationUrl.searchParams.get("code_verifier")).toBeNull();

    // state (CSRF on the callback) and nonce (binds the issued ID token).
    expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("nonce")).toBeTruthy();
    for (const name of ["authjs.state", "authjs.nonce"]) {
      const cookie = setCookies(response).find((value) => value.startsWith(`${name}=`));
      expect(cookie).toBeTruthy();
      // Encrypted at rest in an httpOnly cookie — not readable by browser JS.
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toMatch(/AuthJs|eyJhbGciOiJkaXIi/);
    }

    // The tokens themselves never appear in the authorization request.
    expect(authorizationUrl.searchParams.get("client_secret")).toBeNull();
  });

  it("refuses a sign-in POST that carries no CSRF token", async () => {
    const response = await postSignIn({ csrf: false });

    // Auth.js answers the failed check with a redirect to its own error page,
    // never with a redirect to the identity provider.
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("error");
    expect(location).not.toContain("idp.test");
  });

  it("does not establish a session when the callback state does not match", async () => {
    const response = await handlers.GET(
      authRequest(
        new Request(
          `${AUTH_BASE}/callback/keycloak?code=forged-code&state=forged-state`,
        ),
      ),
    );

    const cookies = setCookies(response).join("; ");
    expect(cookies).not.toContain("authjs.session-token");
    expect(response.headers.get("location") ?? "").not.toBe(
      "http://localhost/admin",
    );
  });

  it("reports no identity while the session cookie is absent", async () => {
    const response = await handlers.GET(authRequest(new Request(`${AUTH_BASE}/session`)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("null");
  });
});

describe("redirect allowlist", () => {
  it("allows the platform origin and relative targets", async () => {
    await expect(
      redirect({ url: "http://localhost/admin", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost/admin");
    await expect(
      redirect({ url: "/admin/organizations", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost:3000/admin/admin/organizations");
    await expect(
      redirect({ url: "http://localhost/admin/", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost/admin/");
  });

  it("refuses redirect targets on any other origin", async () => {
    await expect(
      redirect({ url: "https://evil.example/admin", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost:3000/admin");
    await expect(
      redirect({ url: "http://localhost.evil.example/", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost:3000/admin");
    await expect(
      redirect({ url: "https://idp.test/realms/uog", baseUrl: "http://localhost:3000/admin" }),
    ).resolves.toBe("http://localhost:3000/admin");
  });
});
