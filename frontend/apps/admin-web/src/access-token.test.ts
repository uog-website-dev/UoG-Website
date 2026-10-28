/**
 * Expiry and refresh behaviour of the Keycloak access token that the Auth.js
 * session carries.
 *
 * The token lives five minutes (realm `accessTokenLifespan`), so an expired
 * one has to be exchanged for a fresh one through the realm's token endpoint
 * using the refresh token stored server-side in the session cookie. When that
 * exchange cannot happen the action must fail closed: `null` is returned, the
 * API call goes out without an Authorization header and Django answers 401.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/session-jwt", () => ({
  getSessionToken: vi.fn(),
}));

import { getAccessToken } from "@/access-token";
import { getSessionToken } from "@/session-jwt";

const session = vi.mocked(getSessionToken);
const fetchMock = vi.fn();

const TOKEN_URL = "https://idp.test/realms/uog/protocol/openid-connect/token";
const now = () => Math.floor(Date.now() / 1000);

/** A session carrying Keycloak tokens, with the given overrides. */
function sessionToken(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "header.payload.signature",
    accessTokenExpires: now() + 300,
    refreshToken: "refresh-token-1",
    idToken: "id-token-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KEYCLOAK_TOKEN_URL", TOKEN_URL);
  vi.stubEnv("KEYCLOAK_CLIENT_ID", "admin-web");
  vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "admin-web-test-secret");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("access token expiry and refresh", () => {
  it("returns null without any network call when nobody is signed in", async () => {
    session.mockResolvedValue(null);

    await expect(getAccessToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a token that has not expired", async () => {
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() + 300 }));

    await expect(getAccessToken()).resolves.toBe("header.payload.signature");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a token inside the safety skew as expired", async () => {
    // Expiry skew is 15 seconds: a token with 5 seconds left is refreshed.
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() + 5 }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-token" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getAccessToken()).resolves.toBe("fresh-token");
  });

  it("exchanges an expired token for a fresh one with the stored refresh token", async () => {
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() - 60 }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-token" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getAccessToken()).resolves.toBe("fresh-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");

    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-token-1");
    expect(body.get("client_id")).toBe("admin-web");
    expect(body.get("client_secret")).toBe("admin-web-test-secret");
    // The already-expired access token is never replayed to the token endpoint.
    expect(body.get("access_token")).toBeNull();
  });

  it("fails closed when the token endpoint rejects the refresh", async () => {
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() - 60 }));
    fetchMock.mockResolvedValue(
      new Response("invalid_grant", { status: 401 }),
    );

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("fails closed when the identity provider is unreachable", async () => {
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() - 60 }));
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("returns null when the expired token has no refresh token", async () => {
    session.mockResolvedValue(
      sessionToken({ accessTokenExpires: now() - 60, refreshToken: null }),
    );

    await expect(getAccessToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot refresh at all when the client secret is not configured server-side", async () => {
    vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "");
    session.mockResolvedValue(sessionToken({ accessTokenExpires: now() - 60 }));

    await expect(getAccessToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
