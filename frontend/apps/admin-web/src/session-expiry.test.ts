import { describe, expect, it } from "vitest";

import { safeReturnTo, sessionExpiredHref } from "@/session-expiry";

describe("session expiry return path", () => {
  it("keeps console paths with their query", () => {
    expect(safeReturnTo("/admin/sites/2/admin/pages?create=1")).toBe("/admin/sites/2/admin/pages?create=1");
    expect(safeReturnTo("/admin")).toBe("/admin");
  });

  it("falls back to the console home for anything outside the console", () => {
    for (const value of [null, "", "https://evil.test/admin", "//evil.test", "/public", "/administrator", "/admin\\..\\x", "/admin/api/session/expired"]) {
      expect(safeReturnTo(value)).toBe("/admin/");
    }
  });

  it("encodes the return path into the expired-session route", () => {
    expect(sessionExpiredHref()).toBe("/admin/api/session/expired");
    expect(sessionExpiredHref("/admin/sites/2/admin")).toBe("/admin/api/session/expired?returnTo=%2Fadmin%2Fsites%2F2%2Fadmin");
  });
});
