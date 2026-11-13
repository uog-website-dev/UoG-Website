import { describe, expect, it, vi } from "vitest";
import { runBulkLifecycle, summarizeBulkLifecycle } from "./bulk-lifecycle";

describe("bulk lifecycle helpers", () => {
  it("applies each item and collects failures without stopping", async () => {
    const apply = vi.fn(async (item: { id: number; label: string }) =>
      item.id === 2
        ? { ok: false as const, error: { status: 400, code: "api_error", message: "Blocked", details: null, requestId: null } }
        : { ok: true as const, data: item },
    );
    const summary = await runBulkLifecycle(
      [{ id: 1, label: "One" }, { id: 2, label: "Two" }, { id: 3, label: "Three" }],
      { labelOf: (item) => item.label, apply },
    );
    expect(apply).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      attempted: 3,
      succeeded: 2,
      failed: [{ id: 2, label: "Two", ok: false, message: "Blocked" }],
    });
    expect(summarizeBulkLifecycle(summary, "site")).toBe("Deleted 2 of 3 sites. 1 failed.");
  });
});
