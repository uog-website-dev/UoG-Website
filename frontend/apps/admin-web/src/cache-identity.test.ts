// @vitest-environment node
import {beforeEach, expect, it, vi} from "vitest";
const session = vi.fn();
vi.mock("@/session-jwt", () => ({getSessionToken: () => session()}));
import {getCacheIdentity} from "./cache-identity";
beforeEach(() => {session.mockReset();});
it("returns only the non-credential session nonce and denies an unidentified session", async () => {
  session.mockResolvedValue({sub: "user-A", cacheSessionId: "opaque-session-A", accessToken: "PRIVATE_ACCESS", refreshToken: "PRIVATE_REFRESH", idToken: "PRIVATE_ID"});
  expect(await getCacheIdentity()).toBe("opaque-session-A");
  session.mockResolvedValue(null); expect(await getCacheIdentity()).toBeNull();
  session.mockResolvedValue({accessToken: "PRIVATE_ACCESS"}); expect(await getCacheIdentity()).toBeNull();
});
it("isolates legacy users and logins without returning subject IDs or bearer credentials", async () => {
  session.mockResolvedValue({sub: "private-user-A", iat: 1, accessToken: "PRIVATE_ACCESS"}); const a = await getCacheIdentity();
  session.mockResolvedValue({sub: "private-user-B", iat: 1}); const b = await getCacheIdentity();
  session.mockResolvedValue({sub: "private-user-A", iat: 2}); const next = await getCacheIdentity();
  expect(a).toMatch(/^[0-9a-f]{64}$/); expect(new Set([a, b, next]).size).toBe(3);
});
