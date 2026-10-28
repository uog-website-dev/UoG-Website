/**
 * Session actions: starting the Keycloak sign-in and ending both the local
 * session and the Keycloak SSO session on sign-out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  issuer: "https://idp.test/realms/uog",
  siteOrigin: "http://localhost",
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/session-jwt", () => ({
  getSessionToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { signIn, signOut } from "@/auth";
import { getSessionToken } from "@/session-jwt";
import { redirect } from "next/navigation";

import { signInWithKeycloak, signOutFromSite } from "./actions";

const signInMock = vi.mocked(signIn);
const signOutMock = vi.mocked(signOut);
const redirectMock = vi.mocked(redirect);
const getSessionTokenMock = vi.mocked(getSessionToken);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sign in", () => {
  it("starts the Keycloak flow through Auth.js (which owns the CSRF token)", async () => {
    signInMock.mockResolvedValue(undefined as never);

    await signInWithKeycloak();

    expect(signInMock).toHaveBeenCalledWith("keycloak", {
      redirectTo: "http://localhost/admin",
    });
  });
});

describe("sign out", () => {
  it("clears the local session first, then follows Keycloak sign-out with the ID token", async () => {
    getSessionTokenMock.mockResolvedValue({ idToken: "the-id-token" } as never);
    signOutMock.mockResolvedValue(undefined as never);
    redirectMock.mockImplementation((() => undefined) as never);

    await signOutFromSite();

    // The local Auth.js session cookie is destroyed before anything else.
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });

    const logoutUrl = new URL(redirectMock.mock.calls[0][0] as unknown as string);
    expect(`${logoutUrl.origin}${logoutUrl.pathname}`).toBe(
      "https://idp.test/realms/uog/protocol/openid-connect/logout",
    );
    expect(logoutUrl.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(logoutUrl.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost/admin/",
    );

    // The session has to be destroyed before the browser is redirected away.
    expect(signOutMock.mock.invocationCallOrder[0]).toBeLessThan(
      redirectMock.mock.invocationCallOrder[0],
    );
  });

  it("still ends the Keycloak session when the ID token is missing", async () => {
    getSessionTokenMock.mockResolvedValue(null);
    signOutMock.mockResolvedValue(undefined as never);
    redirectMock.mockImplementation((() => undefined) as never);

    await signOutFromSite();

    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    const logoutUrl = new URL(redirectMock.mock.calls[0][0] as unknown as string);
    expect(logoutUrl.searchParams.get("id_token_hint")).toBeNull();
    expect(logoutUrl.searchParams.get("client_id")).toBe("admin-web");
    expect(logoutUrl.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost/admin/",
    );
  });
});
