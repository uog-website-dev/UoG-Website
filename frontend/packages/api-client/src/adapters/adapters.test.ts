import { describe, expect, it, vi } from "vitest";

import type { Organization } from "@uog/types";

import { ApiError } from "../errors";
import { organizationFixtures } from "../fixtures/organizations";
import { siteFixtures } from "../fixtures/sites";
import {
  createMockOrganizationsAdapter,
  createLiveOrganizationsAdapter,
  organizationListQueryString,
  ORGANIZATIONS_PAGE_SIZE,
} from "./organizations";
import { createLiveSitesAdapter, createMockSitesAdapter } from "./sites";
import { ApiModeError, isNotImplemented, resolveApiMode } from "./mode";
import { createOrganizationsAdapter, createSitesAdapter } from "./factory";

/** No latency so tests are deterministic and fast. */
const instant = { latencyMs: 0 };

describe("resolveApiMode", () => {
  it("defaults to live in production", () => {
    expect(resolveApiMode({ isProduction: true })).toBe("live");
  });

  it("defaults to mock in development", () => {
    expect(resolveApiMode({ isProduction: false })).toBe("mock");
  });

  it("honours an explicit live mode in any environment", () => {
    expect(resolveApiMode({ configured: "live", isProduction: true })).toBe("live");
    expect(resolveApiMode({ configured: "live", isProduction: false })).toBe("live");
  });

  it("refuses mock in a production build (no fabricated responses)", () => {
    expect(() => resolveApiMode({ configured: "mock", isProduction: true })).toThrow(
      ApiModeError,
    );
    expect(() => resolveApiMode({ configured: "mock", isProduction: true })).toThrow(
      /not allowed in a production build/,
    );
  });

  it("allows mock in development", () => {
    expect(resolveApiMode({ configured: "mock", isProduction: false })).toBe("mock");
  });

  it("rejects an unknown mode value instead of guessing", () => {
    expect(() => resolveApiMode({ configured: "staging", isProduction: false })).toThrow(
      ApiModeError,
    );
  });

  it("treats blank and whitespace values as unset", () => {
    expect(resolveApiMode({ configured: "  ", isProduction: false })).toBe("mock");
    expect(resolveApiMode({ configured: "", isProduction: true })).toBe("live");
  });
});

describe("factory", () => {
  it("builds the live Organizations adapter when mode is live", async () => {
    const adapter = createOrganizationsAdapter({ mode: "live", baseUrl: "/api" });
    // Live adapter's list performs a real fetch, so it rejects without a
    // backend rather than returning fixture data.
    await expect(adapter.list()).rejects.toBeInstanceOf(ApiError);
  });

  it("builds the Sites adapter and refuses to fabricate in live mode", async () => {
    const adapter = createSitesAdapter({ mode: "live" });
    await expect(adapter.list()).rejects.toMatchObject({ status: 501 });
    expect(isNotImplemented).toBeTypeOf("function");
  });
});

describe("createLiveSitesAdapter", () => {
  it("refuses list with an explicit 501 instead of inventing data", async () => {
    const adapter = createLiveSitesAdapter();
    await expect(adapter.list()).rejects.toMatchObject({ status: 501 });
  });

  it("refuses get with an explicit 501", async () => {
    const adapter = createLiveSitesAdapter();
    await expect(adapter.get(1)).rejects.toMatchObject({ status: 501 });
  });
});

describe("createMockOrganizationsAdapter", () => {
  it("returns the paginated envelope with a fixed page size", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const page = await adapter.list();

    expect(page.count).toBe(organizationFixtures.length);
    expect(page.results.length).toBeLessThanOrEqual(ORGANIZATIONS_PAGE_SIZE);
    expect(page.next).toBeNull();
    expect(page.previous).toBeNull();
  });

  it("filters by search across name and code", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const page = await adapter.list({ search: "informatics" });

    expect(page.count).toBe(1);
    expect(page.results[0].code).toBe("INFORMATICS");
  });

  it("filters by status", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const page = await adapter.list({ status: "INACTIVE" });

    expect(page.results.map((org) => org.code)).toEqual(["SOFTWARE_ENG"]);
  });

  it("filters roots with parent=null", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const page = await adapter.list({ parent: "null" });

    expect(page.results.map((org) => org.code)).toEqual(["UOG"]);
  });

  it("orders by the requested field, descending", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const page = await adapter.list({ ordering: "-name" });

    const names = page.results.map((org) => org.name);
    const sorted = [...names].sort((a, b) => b.localeCompare(a));
    expect(names).toEqual(sorted);
  });

  it("returns a strong ETag on detail", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const detail = await adapter.get(1);

    expect(detail.etag).toMatch(/^".+"$/);
    expect(detail.data.code).toBe("UOG");
  });

  it("404s for an unknown id", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    await expect(adapter.get(99999)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a stale ETag on update with 412", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    await expect(
      adapter.update(1, '"stale"', { name: "Nope" }),
    ).rejects.toMatchObject({ status: 412, code: "precondition_failed" });
  });

  it("rejects a duplicate code on create with 409", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    await expect(
      adapter.create({
        code: "uog",
        name: "Duplicate",
        organization_type: "UNIVERSITY",
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("normalises a created code to uppercase", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const created = await adapter.create({
      code: "  new_college ",
      name: "New College",
      organization_type: "COLLEGE",
    });

    expect(created.data.code).toBe("NEW_COLLEGE");
    expect(created.data.status).toBe("ACTIVE");
  });

  it("transitions status through deactivate and archive", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const detail = await adapter.get(1);
    const deactivated = await adapter.deactivate(1, detail.etag!);
    expect(deactivated.data.status).toBe("INACTIVE");

    const archived = await adapter.archive(1, deactivated.etag!);
    expect(archived.data.status).toBe("ARCHIVED");
  });

  it("does not leak fixture objects between calls", async () => {
    const adapter = createMockOrganizationsAdapter(instant);
    const first = await adapter.get(1);
    first.data.name = "MUTATED";
    const second = await adapter.get(1);

    expect(second.data.name).toBe("University of Gondar");
  });
});

describe("createMockSitesAdapter", () => {
  it("paginates the site fixtures", async () => {
    const adapter = createMockSitesAdapter(instant);
    const page = await adapter.list();

    expect(page.count).toBe(siteFixtures.length);
    expect(page.results.length).toBe(siteFixtures.length);
  });

  it("filters by status", async () => {
    const adapter = createMockSitesAdapter(instant);
    const page = await adapter.list({ status: "DRAFT" });

    expect(page.results.map((site) => site.slug)).toEqual(["research"]);
  });

  it("404s for an unknown id", async () => {
    const adapter = createMockSitesAdapter(instant);
    await expect(adapter.get(99999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("organizationListQueryString", () => {
  it("drops undefined, null and blank values", () => {
    expect(
      organizationListQueryString({
        search: "",
        name: undefined,
        code: "  ",
        status: undefined,
      }),
    ).toBe("");
  });

  it("encodes present filters", () => {
    const query = organizationListQueryString({
      search: "college",
      status: "ACTIVE",
      page: 2,
    });

    expect(query).toContain("search=college");
    expect(query).toContain("status=ACTIVE");
    expect(query).toContain("page=2");
  });

  it("passes the literal 'null' parent through for roots", () => {
    expect(organizationListQueryString({ parent: "null" })).toBe("parent=null");
  });

  it("stringifies a numeric parent", () => {
    expect(organizationListQueryString({ parent: 7 })).toBe("parent=7");
  });
});

describe("fixture contract conformance", () => {
  const REQUIRED_FIELDS: (keyof Organization)[] = [
    "id",
    "code",
    "name",
    "short_name",
    "organization_type",
    "parent",
    "description",
    "status",
    "metadata",
    "created_at",
    "updated_at",
  ];

  it("every organization fixture carries exactly the documented DTO fields", () => {
    for (const fixture of organizationFixtures) {
      expect(Object.keys(fixture).sort()).toEqual([...REQUIRED_FIELDS].sort());
    }
  });

  it("organization fixtures use the documented status values", () => {
    for (const fixture of organizationFixtures) {
      expect(["ACTIVE", "INACTIVE", "ARCHIVED"]).toContain(fixture.status);
    }
  });

  it("organization timestamps are ISO-8601 strings", () => {
    for (const fixture of organizationFixtures) {
      expect(Number.isNaN(Date.parse(fixture.created_at))).toBe(false);
      expect(Number.isNaN(Date.parse(fixture.updated_at))).toBe(false);
    }
  });

  it("organization parent references resolve within the fixture set", () => {
    const ids = new Set(organizationFixtures.map((org) => org.id));
    for (const fixture of organizationFixtures) {
      if (fixture.parent !== null) {
        expect(ids.has(fixture.parent)).toBe(true);
      }
    }
  });

  it("site fixtures carry exactly the documented provisional fields", () => {
    const required = [
      "id",
      "name",
      "slug",
      "organization",
      "status",
      "domains",
      "created_at",
      "updated_at",
    ];
    for (const fixture of siteFixtures) {
      expect(Object.keys(fixture).sort()).toEqual([...required].sort());
    }
  });

  it("site fixtures use the documented status values", () => {
    for (const fixture of siteFixtures) {
      expect(["DRAFT", "PUBLISHED", "ARCHIVED"]).toContain(fixture.status);
    }
  });
});

describe("createLiveOrganizationsAdapter", () => {
  it("sends the request to the configured base URL and path", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = createLiveOrganizationsAdapter({
      baseUrl: "http://backend:8000/api",
      fetchFn,
    });

    await adapter.list({ search: "x", page: 1 });

    const [url] = calls[0];
    expect(url).toBe("http://backend:8000/api/v1/organizations/?search=x&page=1");
  });

  it("propagates the backend's structured 400 for a bad filter", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "validation_error", message: "The request is invalid.", details: { bogus: ["Unknown query parameter."] } },
            request_id: "req-400",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const adapter = createLiveOrganizationsAdapter({
      baseUrl: "/api",
      fetchFn,
    });

    await expect(adapter.list({} as never)).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      requestId: "req-400",
    });
  });

  it("captures the strong ETag from a detail response", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 1, code: "UOG" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: '"abc123"',
            "X-Request-ID": "req-etag",
          },
        }),
    ) as unknown as typeof fetch;

    const adapter = createLiveOrganizationsAdapter({ baseUrl: "/api", fetchFn });
    const detail = await adapter.get(1);

    expect(detail.etag).toBe('"abc123"');
    expect(detail.requestId).toBe("req-etag");
  });

  it("sends If-Match on a conditional update", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"new"' },
      });
    }) as unknown as typeof fetch;

    const adapter = createLiveOrganizationsAdapter({ baseUrl: "/api", fetchFn });
    await adapter.update(1, '"old"', { name: "Renamed" });

    const [, init] = calls[0];
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"old"');
    expect(init.body).toBe(JSON.stringify({ name: "Renamed" }));
  });
});
