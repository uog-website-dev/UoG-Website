import { describe, expect, it } from "vitest";

import type { Organization } from "@uog/types";

import {
  ORGANIZATION_TYPE_OPTIONS,
  emptyOrganizationForm,
  formValuesFromOrganization,
  normalizeCode,
  organizationTypeLabel,
  parentOptionsFor,
  tryParseMetadata,
  validateOrganizationForm,
} from "./validation";

function org(partial: Partial<Organization>): Organization {
  return {
    id: 1,
    code: "UNIT",
    name: "Unit",
    short_name: "",
    organization_type: "DEPARTMENT",
    parent: null,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("organization type options", () => {
  it("offers a controlled, non-empty set of type codes", () => {
    expect(ORGANIZATION_TYPE_OPTIONS.length).toBeGreaterThanOrEqual(10);
    for (const option of ORGANIZATION_TYPE_OPTIONS) {
      expect(option.value).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("labels known codes and falls back to the raw code for unknown ones", () => {
    expect(organizationTypeLabel("COLLEGE")).toBe("College");
    expect(organizationTypeLabel("CUSTOM_NEW_TYPE")).toBe("CUSTOM_NEW_TYPE");
  });
});

describe("normalizeCode", () => {
  it("trims and upper-cases like the serializer does", () => {
    expect(normalizeCode("  informatics ")).toBe("INFORMATICS");
    expect(normalizeCode("CS_01")).toBe("CS_01");
  });
});

describe("validateOrganizationForm", () => {
  it("accepts a fully populated create form", () => {
    const values = {
      ...emptyOrganizationForm(),
      code: "INFORMATICS",
      name: "College of Informatics",
      organization_type: "COLLEGE",
    };
    expect(validateOrganizationForm(values, { mode: "create" })).toEqual({});
  });

  it("requires code, name and type on create", () => {
    const errors = validateOrganizationForm(emptyOrganizationForm(), {
      mode: "create",
    });
    expect(errors.code).toBeTruthy();
    expect(errors.name).toBeTruthy();
    expect(errors.organization_type).toBeTruthy();
  });

  it("rejects codes that break the canonical pattern", () => {
    const base = {
      ...emptyOrganizationForm(),
      name: "Name",
      organization_type: "COLLEGE",
    };
    expect(validateOrganizationForm({ ...base, code: "1BAD" }, { mode: "create" }).code).toBeTruthy();
    expect(validateOrganizationForm({ ...base, code: "has space" }, { mode: "create" }).code).toBeTruthy();
    expect(validateOrganizationForm({ ...base, code: "" }, { mode: "create" }).code).toBeTruthy();
  });

  it("does not re-validate the immutable code when editing", () => {
    const values = {
      ...emptyOrganizationForm(),
      // A pre-existing code that would be odd to type fresh but is valid.
      code: "EXISTING_CODE",
      name: "Name",
      organization_type: "COLLEGE",
    };
    expect(validateOrganizationForm(values, { mode: "edit" })).toEqual({});
  });

  it("flags a blank name even when whitespace only", () => {
    const values = {
      ...emptyOrganizationForm(),
      code: "X1",
      name: "   ",
      organization_type: "COLLEGE",
    };
    expect(validateOrganizationForm(values, { mode: "create" }).name).toBeTruthy();
  });

  it("rejects metadata that is not valid JSON", () => {
    const values = {
      ...emptyOrganizationForm(),
      code: "X1",
      name: "Name",
      organization_type: "COLLEGE",
      metadata: "{ not json",
    };
    expect(validateOrganizationForm(values, { mode: "create" }).metadata).toBeTruthy();
  });
});

describe("tryParseMetadata", () => {
  it("treats blank as an empty object", () => {
    expect(tryParseMetadata("   ")).toEqual({ value: {} });
  });

  it("parses a JSON object", () => {
    expect(tryParseMetadata('{"established": 1954}')).toEqual({
      value: { established: 1954 },
    });
  });

  it("rejects arrays and scalars, which the backend cannot store", () => {
    expect(tryParseMetadata("[1,2]").error).toBeTruthy();
    expect(tryParseMetadata('"text"').error).toBeTruthy();
    expect(tryParseMetadata("null").error).toBeTruthy();
  });
});

describe("formValuesFromOrganization", () => {
  it("round-trips an organization into editable values", () => {
    const values = formValuesFromOrganization(
      org({
        code: "CI",
        name: "College of Informatics",
        short_name: "CoI",
        organization_type: "COLLEGE",
        parent: 1,
        metadata: { established: 1954 },
      }),
    );
    expect(values.code).toBe("CI");
    expect(values.parent).toBe("1");
    expect(values.organization_type).toBe("COLLEGE");
    expect(JSON.parse(values.metadata)).toEqual({ established: 1954 });
  });

  it("represents a root parent as the empty sentinel", () => {
    expect(formValuesFromOrganization(org({ parent: null })).parent).toBe("");
  });
});

describe("parentOptionsFor", () => {
  const nodes: Organization[] = [
    org({ id: 1, code: "UOG", parent: null, organization_type: "UNIVERSITY" }),
    org({ id: 2, code: "CI", parent: 1 }),
    org({ id: 3, code: "SE", parent: 2 }),
    org({ id: 4, code: "CM", parent: 1 }),
  ];

  it("offers every node when creating (nothing to exclude yet)", () => {
    const options = parentOptionsFor(nodes, null);
    expect(options.map((option) => option.value)).toEqual(["1", "2", "3", "4"]);
  });

  it("excludes the unit being edited to prevent a self-parent", () => {
    const options = parentOptionsFor(nodes, nodes[1]);
    expect(options.map((option) => option.value)).not.toContain("2");
  });

  it("excludes descendants so an obvious cycle cannot be chosen", () => {
    // Editing CI (id 2): its descendant SE (id 3) must not be offered.
    const options = parentOptionsFor(nodes, nodes[1]);
    expect(options.map((option) => option.value)).not.toContain("3");
    // But an unrelated branch (CM) and the root remain selectable.
    expect(options.map((option) => option.value)).toContain("4");
    expect(options.map((option) => option.value)).toContain("1");
  });
});
