import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  serverApiFetch: vi.fn(),
}));

vi.mock("@/access-token", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("@/performance/server-fetch", () => ({ serverApiFetch: mocks.serverApiFetch }));
vi.mock("@/auth", () => ({ siteOrigin: "http://localhost" }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("./dashboard-client", () => ({ default: () => null }));

import AdminHomePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccessToken.mockResolvedValue("access-token");
});

describe("admin home workspace entry", () => {
  it("redirects a Site-only user with one authorized Site directly into that Site", async () => {
    mocks.serverApiFetch
      .mockResolvedValueOnce(Response.json({ platformPermissions: [] }))
      .mockResolvedValueOnce(Response.json({
        count: 1,
        page: 1,
        page_size: 2,
        results: [{ id: 102, name: "AAU Builder Comparison", code: "AAU-COMPARISON", status: "ACTIVE" }],
      }));

    await expect(AdminHomePage()).rejects.toThrow("REDIRECT http://localhost/admin/sites/102/admin");
    expect(mocks.serverApiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not run Site discovery for platform administrators", async () => {
    mocks.serverApiFetch.mockResolvedValueOnce(Response.json({ platformPermissions: ["platform.dashboard.view"] }));

    await AdminHomePage();

    expect(mocks.serverApiFetch).toHaveBeenCalledTimes(1);
  });
});
