import { describe, expect, it } from "vitest";

import type { PlatformModule, SiteModuleAssignment } from "@uog/types";

import { createLiveSitesAdapter, createMockSitesAdapter } from "./sites";

/** No latency so tests are deterministic and fast. */
const instant = { latencyMs: 0 };

const STAMP = "2026-01-01T00:00:00Z";

/** An approved schema with all three property types, like the backend test. */
const EVENTS_SCHEMA = {
  schema_version: 1,
  properties: [
    { code: "PAGE_SIZE", label: "Page size", type: "integer", required: true },
    { code: "FEED_TITLE", label: "Feed title", type: "string", required: false },
    {
      code: "SHOW_ARCHIVE",
      label: "Show archive",
      type: "boolean",
      required: false,
    },
  ],
} as unknown as Record<string, unknown>;

function moduleFixture(partial: Partial<PlatformModule> = {}): PlatformModule {
  return {
    id: 10,
    code: "EVENTS",
    name: "Events",
    description: "Calendar and events.",
    status: "IMPLEMENTED",
    is_enabled: true,
    configuration_schema: EVENTS_SCHEMA,
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function assignmentFixture(
  partial: Partial<SiteModuleAssignment> = {},
): SiteModuleAssignment {
  return {
    id: 1,
    site: 1,
    module: 10,
    is_enabled: true,
    configuration: { PAGE_SIZE: 20 },
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

describe("createMockSitesAdapter — module enablement", () => {
  it("enables a usable module for a site and stores its settings", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
    });

    const created = await adapter.createModuleAssignment(1, {
      module: 10,
      configuration: { PAGE_SIZE: 20 },
    });

    expect(created.data.is_enabled).toBe(true);
    expect(created.data.configuration).toEqual({ PAGE_SIZE: 20 });
    expect(created.etag).toMatch(/^".+"$/);

    const rows = await adapter.listModuleAssignments(1, { module: 10 });
    expect(rows.count).toBe(1);
    expect(rows.results[0].is_enabled).toBe(true);
  });

  it("refuses a PLANNED module with the backend's usability message", async () => {
    // Default fixtures: every seeded capability is planned and globally off.
    const adapter = createMockSitesAdapter(instant);

    await expect(
      adapter.createModuleAssignment(1, { module: 1 }),
    ).rejects.toMatchObject({
      status: 400,
      details: {
        module: [
          "A disabled or unimplemented module cannot be enabled for a Site.",
        ],
      },
    });
  });

  it("refuses an implemented module that is switched off platform-wide", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture({ is_enabled: false })],
    });

    // The configuration is valid, so the refusal comes from the usability
    // rule — which the backend checks after model.full_clean, exactly like
    // this order.
    await expect(
      adapter.createModuleAssignment(1, {
        module: 10,
        configuration: { PAGE_SIZE: 20 },
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: {
        module: [
          "A disabled or unimplemented module cannot be enabled for a Site.",
        ],
      },
    });
  });

  it("returns 409 for a duplicate site/module pair", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
      seedModuleAssignments: [assignmentFixture()],
    });

    await expect(
      adapter.createModuleAssignment(1, { module: 10 }),
    ).rejects.toMatchObject({
      status: 409,
      details: { module: ["This Site already has this module."] },
    });
  });

  it("400s an unknown module id instead of guessing one", async () => {
    const adapter = createMockSitesAdapter(instant);
    await expect(
      adapter.createModuleAssignment(1, { module: 999 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("404s an unknown site before any module check", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
    });
    await expect(
      adapter.createModuleAssignment(99999, { module: 10 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("validates settings against the module's approved schema", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
    });

    // Missing required property.
    await expect(
      adapter.createModuleAssignment(1, { module: 10, configuration: {} }),
    ).rejects.toMatchObject({
      status: 400,
      details: {
        configuration: [
          "Site module configuration is missing a required property.",
        ],
      },
    });

    // Wrong type for an integer property.
    await expect(
      adapter.createModuleAssignment(1, {
        module: 10,
        configuration: { PAGE_SIZE: "many" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: { configuration: ["Site module configuration is not approved."] },
    });

    // Unknown key — no free-form documents pass.
    await expect(
      adapter.createModuleAssignment(1, {
        module: 10,
        configuration: { PAGE_SIZE: 10, BOGUS: true },
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Secret-looking keys are refused outright.
    await expect(
      adapter.createModuleAssignment(1, {
        module: 10,
        configuration: { PAGE_SIZE: 10, API_TOKEN: "nope" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: {
        configuration: [
          "Module configuration schema cannot describe secrets.",
        ],
      },
    });
  });

  it("disable keeps the row and configuration; re-enable restores them", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
      seedModuleAssignments: [assignmentFixture()],
    });

    const current = await adapter.getModuleAssignment(1, 1);
    const disabled = await adapter.disableModuleAssignment(1, 1, current.etag!);

    expect(disabled.data.is_enabled).toBe(false);
    expect(disabled.data.configuration).toEqual({ PAGE_SIZE: 20 });

    const rows = await adapter.listModuleAssignments(1);
    expect(rows.count).toBe(1);
    expect(rows.results[0].configuration).toEqual({ PAGE_SIZE: 20 });

    const reenabled = await adapter.enableModuleAssignment(
      1,
      1,
      disabled.etag!,
    );
    expect(reenabled.data.is_enabled).toBe(true);
    expect(reenabled.data.configuration).toEqual({ PAGE_SIZE: 20 });
  });

  it("refuses to re-enable an assignment whose module is no longer usable", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      // Deprecated: still assignable as a stored row, but not enableable.
      seedModules: [moduleFixture({ status: "DEPRECATED" })],
      seedModuleAssignments: [assignmentFixture()],
    });

    const current = await adapter.getModuleAssignment(1, 1);
    const disabled = await adapter.disableModuleAssignment(1, 1, current.etag!);

    await expect(
      adapter.enableModuleAssignment(1, 1, disabled.etag!),
    ).rejects.toMatchObject({
      status: 400,
      details: {
        module: [
          "A disabled or unimplemented module cannot be enabled for a Site.",
        ],
      },
    });
  });

  it("PATCH replaces settings wholesale without touching enablement", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
      seedModuleAssignments: [
        assignmentFixture({ is_enabled: false, configuration: { PAGE_SIZE: 10 } }),
      ],
    });

    const current = await adapter.getModuleAssignment(1, 1);
    const updated = await adapter.updateModuleAssignment(1, 1, current.etag!, {
      PAGE_SIZE: 50,
      SHOW_ARCHIVE: true,
    });

    expect(updated.data.configuration).toEqual({
      PAGE_SIZE: 50,
      SHOW_ARCHIVE: true,
    });
    // Enablement is read-only on the endpoint — PATCH never toggles it.
    expect(updated.data.is_enabled).toBe(false);
  });

  it("rejects a stale ETag on every conditional module write with 412", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
      seedModuleAssignments: [assignmentFixture()],
    });

    await expect(
      adapter.disableModuleAssignment(1, 1, '"stale"'),
    ).rejects.toMatchObject({ status: 412, code: "precondition_failed" });
    await expect(
      adapter.enableModuleAssignment(1, 1, '"stale"'),
    ).rejects.toMatchObject({ status: 412, code: "precondition_failed" });
    await expect(
      adapter.updateModuleAssignment(1, 1, '"stale"', { PAGE_SIZE: 5 }),
    ).rejects.toMatchObject({ status: 412, code: "precondition_failed" });
  });

  it("404s an assignment id under another site or an unknown id", async () => {
    const adapter = createMockSitesAdapter({
      ...instant,
      seedModules: [moduleFixture()],
      seedModuleAssignments: [assignmentFixture({ site: 1 })],
    });

    await expect(adapter.getModuleAssignment(2, 1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(adapter.getModuleAssignment(1, 99999)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      adapter.disableModuleAssignment(2, 1, '"x"'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("createLiveSitesAdapter — module endpoints", () => {
  function recordingFetch() {
    const calls: [string, RequestInit][] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({ id: 1, site: 1, module: 10, is_enabled: true, configuration: {} }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: '"assignment-etag"',
            "X-Request-ID": "req-1",
          },
        },
      );
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("sends create, enable, disable and PATCH to the documented paths", async () => {
    const { calls, fetchFn } = recordingFetch();
    const adapter = createLiveSitesAdapter({ baseUrl: "/api", fetchFn });

    await adapter.createModuleAssignment(3, {
      module: 10,
      configuration: { PAGE_SIZE: 20 },
    });
    await adapter.enableModuleAssignment(3, 5, '"etag"');
    await adapter.disableModuleAssignment(3, 5, '"etag"');
    await adapter.updateModuleAssignment(3, 5, '"etag"', { PAGE_SIZE: 10 });

    const [createUrl, createInit] = calls[0];
    expect(createUrl).toBe("/api/v1/sites/3/modules/");
    expect(createInit.method).toBe("POST");
    expect(createInit.body).toBe(
      JSON.stringify({ module: 10, configuration: { PAGE_SIZE: 20 } }),
    );

    const [enableUrl, enableInit] = calls[1];
    expect(enableUrl).toBe("/api/v1/sites/3/modules/5/enable/");
    expect((enableInit.headers as Record<string, string>)["If-Match"]).toBe(
      '"etag"',
    );

    const [disableUrl] = calls[2];
    expect(disableUrl).toBe("/api/v1/sites/3/modules/5/disable/");

    const [patchUrl, patchInit] = calls[3];
    expect(patchUrl).toBe("/api/v1/sites/3/modules/5/");
    expect(patchInit.method).toBe("PATCH");
    expect((patchInit.headers as Record<string, string>)["If-Match"]).toBe(
      '"etag"',
    );
    expect(patchInit.body).toBe(
      JSON.stringify({ configuration: { PAGE_SIZE: 10 } }),
    );
  });

  it("reads an assignment's ETag and filters assignments by module id", async () => {
    const { calls, fetchFn } = recordingFetch();
    const adapter = createLiveSitesAdapter({ baseUrl: "/api", fetchFn });

    const detail = await adapter.getModuleAssignment(3, 5);
    expect(detail.etag).toBe('"assignment-etag"');
    expect(detail.requestId).toBe("req-1");

    await adapter.listModuleAssignments(3, { module: 10 });
    expect(calls[1][0]).toBe("/api/v1/sites/3/modules/?module=10");
  });
});
