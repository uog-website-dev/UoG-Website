import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
const signIn = vi.fn(async (_provider: string, options: { redirectTo: string }) => {
  throw new Error(`SIGNIN ${options.redirectTo}`);
});
const signOut = vi.fn(async () => undefined);
const getAccessToken = vi.fn<() => Promise<string | null>>();
const getSessionToken = vi.fn<() => Promise<object | null>>();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/auth", () => ({
  signIn: (provider: string, options: { redirectTo: string }) => signIn(provider, options),
  signOut: () => signOut(),
  siteOrigin: "http://localhost",
}));
vi.mock("@/access-token", () => ({ getAccessToken: () => getAccessToken() }));
vi.mock("@/session-jwt", () => ({ getSessionToken: () => getSessionToken() }));

import { GET } from "./route";

function request(returnTo?: string) {
  const url = new URL("http://localhost/admin/api/session/expired");
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expired session route", () => {
  it("signs out an expired session and starts a sign-in that returns to the page", async () => {
    getSessionToken.mockResolvedValue({ accessToken: "old" });
    getAccessToken.mockResolvedValue(null);
    await expect(GET(request("/admin/sites/2/admin"))).rejects.toThrow("SIGNIN http://localhost/admin/sites/2/admin");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("leaves a usable session signed in", async () => {
    getSessionToken.mockResolvedValue({ accessToken: "live" });
    getAccessToken.mockResolvedValue("live");
    await expect(GET(request("/admin/organizations"))).rejects.toThrow("REDIRECT http://localhost/admin/organizations");
    expect(signOut).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("never returns to another origin", async () => {
    getSessionToken.mockResolvedValue(null);
    await expect(GET(request("https://evil.test/"))).rejects.toThrow("SIGNIN http://localhost/admin/");
    expect(signOut).not.toHaveBeenCalled();
  });
});
