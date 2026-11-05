import { beforeEach, describe, expect, it, vi } from "vitest";

const permissions = vi.fn();
const sites = vi.fn();
const assignments = vi.fn();
vi.mock("@/access-control", () => ({ getEffectivePermissions: (...args: unknown[]) => permissions(...args) }));
vi.mock("@/app/sites/actions", () => ({
  listAllSites: () => sites(),
  listSiteModuleAssignments: (...args: unknown[]) => assignments(...args),
}));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  permissions.mockImplementation(async (siteId?: number) => siteId == null ? [] : ["content.pages.view"]);
  sites.mockResolvedValue({ ok: true, data: [{ id: 11, name: "Informatics", code: "CI", status: "ACTIVE" }] });
  assignments.mockResolvedValue({ ok: true, data: { results: [
    { site: 11, module_code: "PAGES", is_enabled: true, is_available: true },
    { site: 11, module_code: "POSTS", is_enabled: true, is_available: false },
    { site: 22, module_code: "MENUS", is_enabled: true, is_available: true },
  ] } });
});

describe("workspace API", () => {
  it("returns only authorized choices and effective modules for the selected Site", async () => {
    const response = await GET(new Request("http://localhost/admin/api/workspace?site=11"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      platformPermissions: [], sitesError: null,
      sites: [{ id: 11, name: "Informatics", code: "CI", status: "ACTIVE" }],
      site: { id: 11, permissions: ["content.pages.view"], enabledModuleCodes: ["PAGES"] },
    });
    expect(assignments).toHaveBeenCalledWith(11);
  });

  it("does not fetch permissions or module data for a forged Site selection", async () => {
    const response = await GET(new Request("http://localhost/admin/api/workspace?site=22"));
    expect((await response.json()).site).toBeNull();
    expect(assignments).not.toHaveBeenCalled();
    expect(permissions).toHaveBeenCalledTimes(1); // platform scope only
    expect(permissions).toHaveBeenCalledWith();
  });

  it.each(["site=0", "site=abc", "site=", "site=9007199254740993", "site=11&site=22"])(
    "rejects invalid or ambiguous selection: %s", async (query) => {
      const response = await GET(new Request(`http://localhost/admin/api/workspace?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_site" });
      expect(sites).not.toHaveBeenCalled();
    },
  );

  it("requires a valid session", async () => {
    sites.mockResolvedValue({ ok: false, error: { status: 401, message: "Sign in" } });
    const response = await GET(new Request("http://localhost/admin/api/workspace"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("keeps a failed Site read distinguishable from an empty authorized list", async () => {
    sites.mockResolvedValue({ ok: false, error: { status: 503, message: "Service unavailable" } });
    const response = await GET(new Request("http://localhost/admin/api/workspace?site=11"));
    expect(await response.json()).toMatchObject({ sites: [], site: null, sitesError: "Service unavailable" });
    expect(assignments).not.toHaveBeenCalled();
  });
});
