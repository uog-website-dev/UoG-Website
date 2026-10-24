import { describe, expect, it } from "vitest";
import type { Organization } from "@uog/types";

import {
  buildOrganizationTreeRows,
  countOrganizationDescendants,
  getOrganizationAncestors,
} from "./hierarchy-tree";

function organization(id: number, parent: number | null): Organization {
  return {
    id,
    code: `UNIT_${String(id).padStart(4, "0")}`,
    name: `Unit ${id}`,
    short_name: "",
    organization_type: "DEPARTMENT",
    parent,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("organization hierarchy helpers", () => {
  it("builds deep trees iteratively and only expands visible branches", () => {
    const units = Array.from({ length: 1000 }, (_, index) =>
      organization(index + 1, index === 0 ? null : index),
    );

    const collapsed = buildOrganizationTreeRows(units, new Set([1]));
    expect(collapsed).toHaveLength(2);
    expect(collapsed[1]).toMatchObject({ organization: { id: 2 }, level: 1 });

    const expanded = buildOrganizationTreeRows(units, new Set(), true);
    expect(expanded).toHaveLength(1000);
    expect(expanded[999]).toMatchObject({ organization: { id: 1000 }, level: 999 });
  });

  it("returns ancestors in root-first order and counts the full descendant branch", () => {
    const units = [
      organization(1, null),
      organization(2, 1),
      organization(3, 2),
      organization(4, 1),
      organization(5, 4),
    ];

    expect(getOrganizationAncestors(3, units).map((unit) => unit.id)).toEqual([1, 2]);
    expect(countOrganizationDescendants(1, units)).toBe(4);
    expect(countOrganizationDescendants(2, units)).toBe(1);
  });

  it("keeps orphaned nodes visible without treating their missing parent as accessible", () => {
    const rows = buildOrganizationTreeRows(
      [organization(8, 99), organization(1, null)],
      new Set(),
    );

    expect(rows.map((row) => row.organization.id)).toEqual([1, 8]);
    expect(getOrganizationAncestors(8, [organization(8, 99)])).toEqual([]);
  });
});
