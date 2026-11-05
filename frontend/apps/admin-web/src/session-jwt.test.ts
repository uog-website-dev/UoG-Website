// @vitest-environment node
/**
 * The refreshed Keycloak tokens have to replace the session cookie, including
 * clearing a previous chunked cookie, or the next request keeps presenting
 * the refresh token Keycloak has already retired.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string, _options?: { maxAge?: number }) => {
  jar.set(name, value);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    has: (name: string) => jar.has(name) && jar.get(name) !== "",
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: cookieSet,
  }),
  headers: async () => new Headers(),
}));

import { decode } from "next-auth/jwt";

import { writeSessionToken } from "@/session-jwt";

const SECRET = "test-auth-secret-at-least-32-characters-long";

afterEach(() => {
  jar.clear();
  cookieSet.mockClear();
  vi.unstubAllEnvs();
});

describe("writeSessionToken", () => {
  it("stores the replacement refresh token in the session cookie", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);

    await writeSessionToken({
      sub: "user-1",
      accessToken: "access-2",
      refreshToken: "refresh-2",
      accessTokenExpires: 1_800_000_000,
    });

    const written = cookieSet.mock.calls.find((call) => call[0] === "authjs.session-token");
    expect(written).toBeTruthy();
    const decoded = await decode({
      token: String(written?.[1]),
      secret: SECRET,
      salt: "authjs.session-token",
    });
    expect(decoded).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
  });

  it("clears a previous chunked session cookie when the new value fits in one", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    jar.set("authjs.session-token.0", "old-chunk");
    jar.set("authjs.session-token.1", "old-chunk");

    await writeSessionToken({ sub: "user-1", accessToken: "access-2", refreshToken: "refresh-2" });

    const cleared = cookieSet.mock.calls.filter((call) => call[1] === "" && call[2]?.maxAge === 0);
    expect(cleared.map((call) => call[0]).sort()).toEqual([
      "authjs.session-token.0",
      "authjs.session-token.1",
    ]);
  });
});
