import { describe, expect, it } from "vitest";

import type { Organization, Site } from "@uog/types";
import { defaultSiteConfiguration } from "@uog/api-client";

import { ownerInfoFor, ownerLabel, relationLabel } from "./owner";

function unit(partial: Partial<Organization> & { id: number }): Organization {
  return {
    code: `UNIT_${partial.id}`,
    name: `Unit ${partial.id}`,
    short_name: "",
    organization_type: "OTHER",
    parent: null,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

/** The same institutional tree the site fixtures reference. */
const units: Organization[] = [
  unit({
    id: 1,
    code: "UOG",
    name: "University of Gondar",
    organization_type: "UNIVERSITY",
    parent: null,
  }),
  unit({
    id: 2,
    code: "INFORMATICS",
    name: "College of Informatics",
    organization_type: "COLLEGE",
    parent: 1,
  }),
  unit({
    id: 3,
    code: "SOFTWARE_ENG",
    name: "Software Engineering Department",
    organization_type: "DEPARTMENT",
    parent: 2,
    status: "INACTIVE",
  }),
];

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "",
    organization_unit: 1,
    default_language: "en-us",
    status: "ACTIVE",
    is_main: false,
    template: null,
    configuration: defaultSiteConfiguration("en-us"),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("ownerInfoFor — root and child topology", () => {
  it("classifies a root-owned site and resolves its root name to itself", () => {
    const info = ownerInfoFor(site({ organization_unit: 1, is_main: true }), units);

    expect(info.relation).toBe("root");
    expect(info.code).toBe("UOG");
    expect(info.name).toBe("University of Gondar");
    expect(info.typeLabel).toBe("University");
    expect(info.rootName).toBe("University of Gondar");
    expect(info.ownerStatus).toBe("ACTIVE");
  });

  it("classifies a college-owned site as a child under the institutional root", () => {
    const info = ownerInfoFor(site({ organization_unit: 2 }), units);

    expect(info.relation).toBe("child");
    expect(info.code).toBe("INFORMATICS");
    expect(info.typeLabel).toBe("College");
    expect(info.rootName).toBe("University of Gondar");
  });

  it("does not assume a child site belongs to a department", () => {
    // The owner is a department here, but the *same* classification would
    // apply to a school or institute: relation comes from the parent chain,
    // type comes from the owner's own record — nothing is inferred.
    const info = ownerInfoFor(site({ organization_unit: 3 }), units);

    expect(info.relation).toBe("child");
    expect(info.typeLabel).toBe("Department");
    expect(info.rootName).toBe("University of Gondar");
    expect(info.ownerStatus).toBe("INACTIVE");
  });

  it("represents several sites owned by the same organization", () => {
    const main = ownerInfoFor(site({ organization_unit: 1 }), units);
    const press = ownerInfoFor(
      site({ id: 4, code: "UOG_PRESS", organization_unit: 1 }),
      units,
    );

    expect(main.unitId).toBe(press.unitId);
    expect(ownerLabel(main)).toBe(ownerLabel(press));
  });
});

describe("ownerInfoFor — missing hierarchy data", () => {
  it("falls back to unknown instead of inventing an owner", () => {
    const info = ownerInfoFor(site({ organization_unit: 42 }), units);

    expect(info.relation).toBe("unknown");
    expect(info.code).toBeNull();
    expect(info.name).toBeNull();
    expect(info.typeLabel).toBeNull();
    expect(ownerLabel(info)).toBe("Unit #42");
  });

  it("still knows a designated main site sits on the root", () => {
    const info = ownerInfoFor(
      site({ organization_unit: 42, is_main: true }),
      units,
    );

    expect(info.relation).toBe("root");
  });

  it("stops walking a parent chain that leaves the known set", () => {
    const partial = units.filter((entry) => entry.id !== 1);
    const info = ownerInfoFor(site({ organization_unit: 2 }), partial);

    // The college is known, its root is not in the read: say so without
    // guessing a name.
    expect(info.relation).toBe("child");
    expect(info.rootName).toBeNull();
  });
});

describe("labels", () => {
  it("describes each relation without claiming more than it knows", () => {
    expect(relationLabel("root")).toBe("Root site");
    expect(relationLabel("child")).toBe("Child site");
    expect(relationLabel("unknown")).toBe("Relation unknown");
  });
});
