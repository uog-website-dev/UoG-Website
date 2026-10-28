import { describe, expect, it, vi } from "vitest";

import { siteDomainFixtures } from "../fixtures/sites";
import { createLiveSitesAdapter, createMockSitesAdapter } from "./sites";

/** No latency so tests are deterministic and fast. */
const instant = { latencyMs: 0 };

const STAMP = "2026-01-01T00:00:00Z";

describe("createMockSitesAdapter — listDomainsAll", () => {
  it("joins every fixture domain with its site context", async () => {
    const adapter = createMockSitesAdapter(instant);
    const result = await adapter.listDomainsAll();

    expect(result.count).toBe(siteDomainFixtures.length);

    const www = result.results.find(
      (row) => row.hostname === "www.uog.edu.et",
    )!;
    expect(www.site_code).toBe("UOG_MAIN");
    expect(www.site_name).toBe("University of Gondar");
    expect(www.site_status).toBe("ACTIVE");
    expect(www.organization_unit).toBe(1);
    expect(www.is_primary).toBe(true);

    const press = result.results.find(
      (row) => row.hostname === "press.uog.edu.et",
    )!;
    expect(press.site_code).toBe("UOG_PRESS");
    expect(press.site_status).toBe("SUSPENDED");
    expect(press.status).toBe("INACTIVE");
  });

  it("searches across hostname, site code and site name", async () => {
    const adapter = createMockSitesAdapter(instant);

    const byHostname = await adapter.listDomainsAll({ search: "press.uog" });
    expect(byHostname.results.map((row) => row.hostname)).toEqual([
      "press.uog.edu.et",
    ]);

    const bySiteName = await adapter.listDomainsAll({
      search: "university press",
    });
    expect(bySiteName.count).toBe(1);

    const bySiteCode = await adapter.listDomainsAll({ search: "uog_main" });
    expect(bySiteCode.count).toBe(2);
  });

  it("filters by site, domain type and status", async () => {
    const adapter = createMockSitesAdapter(instant);

    const siteOne = await adapter.listDomainsAll({ site: 1 });
    expect(siteOne.count).toBe(2);
    expect(siteOne.results.every((row) => row.site === 1)).toBe(true);

    const primaries = await adapter.listDomainsAll({ is_primary: true });
    expect(primaries.count).toBe(3);
    expect(primaries.results.every((row) => row.is_primary)).toBe(true);

    const aliases = await adapter.listDomainsAll({ is_primary: false });
    expect(aliases.results.map((row) => row.hostname)).toEqual([
      "uog.edu.et",
    ]);

    const inactive = await adapter.listDomainsAll({ status: "INACTIVE" });
    expect(inactive.results.map((row) => row.hostname)).toEqual([
      "press.uog.edu.et",
    ]);
  });

  it("404s an unknown site filter, like a detail read", async () => {
    const adapter = createMockSitesAdapter(instant);
    await expect(
      adapter.listDomainsAll({ site: 99999 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("orders the composed rows, descending and by site code", async () => {
    const adapter = createMockSitesAdapter(instant);

    const descending = await adapter.listDomainsAll({ ordering: "-hostname" });
    const hostnames = descending.results.map((row) => row.hostname);
    expect(hostnames).toEqual([...hostnames].sort().reverse());

    const bySite = await adapter.listDomainsAll({ ordering: "site" });
    const codes = bySite.results.map((row) => row.site_code);
    expect(codes).toEqual([...codes].sort());
  });

  it("produces the standard pagination envelope", async () => {
    const adapter = createMockSitesAdapter(instant);
    const result = await adapter.listDomainsAll({ page: 2 });

    expect(result.count).toBe(siteDomainFixtures.length);
    // One page only: page 2 is past the end, so no slices and no links.
    expect(result.results).toEqual([]);
    expect(result.next).toBeNull();
    expect(result.previous).toBe("?page=1");
  });
});

describe("createLiveSitesAdapter — listDomainsAll", () => {
  function respond(url: string): Response {
    if (url.includes("/domains/")) {
      const siteId = Number(/sites\/(\d+)\/domains/.exec(url)![1]);
      const rows =
        siteId === 1
          ? [
              {
                id: 1,
                site: 1,
                hostname: "www.uog.edu.et",
                is_primary: true,
                redirect_to_primary: false,
                status: "ACTIVE",
                created_at: STAMP,
                updated_at: STAMP,
              },
            ]
          : [];
      return new Response(
        JSON.stringify({ count: rows.length, next: null, previous: null, results: rows }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (/\/sites\/\d+\/$/.test(url)) {
      return new Response(
        JSON.stringify({
          id: 5,
          code: "ONLY",
          name: "Only Site",
          short_name: "",
          organization_unit: 1,
          default_language: "en",
          status: "DRAFT",
          is_main: false,
          template: null,
          configuration: {},
          created_at: STAMP,
          updated_at: STAMP,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, code: "UOG_MAIN", name: "University of Gondar", short_name: "", organization_unit: 1, default_language: "en-us", status: "ACTIVE", is_main: true, template: null, configuration: {}, created_at: STAMP, updated_at: STAMP },
          { id: 2, code: "COI_PORTAL", name: "College of Informatics", short_name: "", organization_unit: 2, default_language: "en", status: "ACTIVE", is_main: false, template: null, configuration: {}, created_at: STAMP, updated_at: STAMP },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  it("composes the listing from the sites list and per-site domain endpoints", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      return respond(url);
    }) as unknown as typeof fetch;

    const adapter = createLiveSitesAdapter({ baseUrl: "/api", fetchFn });
    const result = await adapter.listDomainsAll();

    expect(calls).toEqual([
      "/api/v1/sites/?page=1",
      "/api/v1/sites/1/domains/?page=1",
      "/api/v1/sites/2/domains/?page=1",
    ]);
    expect(result.count).toBe(1);
    expect(result.results[0]).toMatchObject({
      hostname: "www.uog.edu.et",
      site_code: "UOG_MAIN",
      site_status: "ACTIVE",
      organization_unit: 1,
    });
  });

  it("fetches only the filtered site when a site is given", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      return respond(url);
    }) as unknown as typeof fetch;

    const adapter = createLiveSitesAdapter({ baseUrl: "/api", fetchFn });
    const result = await adapter.listDomainsAll({ site: 5 });

    expect(calls).toEqual([
      "/api/v1/sites/5/",
      "/api/v1/sites/5/domains/?page=1",
    ]);
    expect(result.count).toBe(0);
  });

  it("propagates an unauthorized response instead of fabricating rows", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "not_authenticated", message: "Invalid token." },
            request_id: null,
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const adapter = createLiveSitesAdapter({ baseUrl: "/api", fetchFn });
    await expect(adapter.listDomainsAll()).rejects.toMatchObject({
      status: 401,
    });
  });
});
