/**
 * Controlled organization type options and client-side validation for the
 * organization create/edit forms.
 *
 * The backend is the sole authority on what is valid. This module exists only
 * so a form can give *immediate, usable feedback* before a round trip, and so
 * the type field stays a controlled select rather than free text. It mirrors
 * documented backend rules (see backend/apps/organizations) but deliberately
 * does not try to reproduce the full lifecycle/hierarchy ruleset: those are
 * state-dependent and are enforced authoritatively by the database function
 * `organizations_validate_unit_lifecycle`, whose failures arrive as structured
 * 400/409 responses the form displays verbatim.
 *
 * Nothing here authorizes a write — it only shapes messages.
 */
import type { Organization } from "@uog/types";

/**
 * A single organization type choice.
 *
 * The backend has no read endpoint for organization types (there is no
 * `OrganizationTypeViewSet`), so the option list mirrors the DEC-04 seed set
 * from `apps/organizations/migrations/0002_seed_organization_types.py`. It is
 * a *control* for the select, not a claim about which values the server will
 * accept: the server may hold types an administrator added after install, and
 * it rejects any code it does not know with a field error the form shows.
 * If a types read endpoint is added, this constant should be replaced by it
 * rather than extended by hand.
 */
export const ORGANIZATION_TYPE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "UNIVERSITY", label: "University" },
  { value: "COLLEGE", label: "College" },
  { value: "SCHOOL", label: "School" },
  { value: "INSTITUTE", label: "Institute" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "RESEARCH_CENTER", label: "Research Center" },
  { value: "DIRECTORATE", label: "Directorate" },
  { value: "OFFICE", label: "Office" },
  { value: "ADMINISTRATIVE_UNIT", label: "Administrative Unit" },
  { value: "OTHER", label: "Other" },
];

/** Lifecycle choices the list filter may send (matches the model's choices). */
export const ORGANIZATION_STATUS_OPTIONS: ReadonlyArray<{
  value: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  label: string;
}> = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Human label for a type code, falling back to the raw code when unknown. */
export function organizationTypeLabel(code: string): string {
  return (
    ORGANIZATION_TYPE_OPTIONS.find((option) => option.value === code)?.label ??
    code
  );
}

/**
 * Canonical code pattern, mirroring the model's RegexValidator
 * `\A[A-Z][A-Z0-9_-]{0,63}\Z`. The serializer trims and upper-cases first,
 * so validation runs on the normalized value.
 */
const CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;

/** Max lengths from the model fields, so the form can fail fast locally. */
const MAX = { code: 64, name: 255, shortName: 100 } as const;

export interface OrganizationFormValues {
  code: string;
  name: string;
  short_name: string;
  organization_type: string;
  /** Select value: `""` means "no parent" (root). */
  parent: string;
  description: string;
  /** Raw text from the metadata editor; parsed before submit. */
  metadata: string;
}

/**
 * Normalize a code the way the serializer does: trim and upper-case, so the
 * user is not punished for typing `informatics`.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Empty form state. `organization_type` starts unset to force a real choice. */
export function emptyOrganizationForm(): OrganizationFormValues {
  return {
    code: "",
    name: "",
    short_name: "",
    organization_type: "",
    parent: "",
    description: "",
    metadata: "",
  };
}

/**
 * Seed the form from an existing organization (edit mode).
 *
 * `metadata` round-trips through a readable JSON text block so the field stays
 * a plain controlled textarea.
 */
export function formValuesFromOrganization(
  organization: Organization,
): OrganizationFormValues {
  return {
    code: organization.code,
    name: organization.name,
    short_name: organization.short_name ?? "",
    organization_type: organization.organization_type,
    parent: organization.parent === null ? "" : String(organization.parent),
    description: organization.description ?? "",
    metadata:
      organization.metadata && Object.keys(organization.metadata).length > 0
        ? JSON.stringify(organization.metadata, null, 2)
        : "",
  };
}

/**
 * Field errors a client can determine *without* the server.
 *
 * Returns `{}` when the form looks acceptable — never a claim that it *is*
 * acceptable. Unknown values, lifecycle transitions, hierarchy cycles and
 * duplicate codes are the server's call and are not pre-judged here (a
 * duplicate-code check would need a network call, and the server answers 409
 * authoritatively).
 */
export function validateOrganizationForm(
  values: OrganizationFormValues,
  options: { mode: "create" | "edit" },
): Record<string, string> {
  const errors: Record<string, string> = {};

  const code = normalizeCode(values.code);
  if (options.mode === "create") {
    if (code === "") {
      errors.code = "A code is required.";
    } else if (!CODE_PATTERN.test(code)) {
      errors.code =
        "Use an uppercase letter followed by up to 63 uppercase letters, digits, underscores or hyphens.";
    } else if (code.length > MAX.code) {
      errors.code = `Codes are limited to ${MAX.code} characters.`;
    }
  }

  const name = values.name;
  if (name.trim() === "") {
    errors.name = "A name is required.";
  } else if (name.length > MAX.name) {
    errors.name = `Names are limited to ${MAX.name} characters.`;
  }

  if (values.short_name.length > MAX.shortName) {
    errors.short_name = `Short names are limited to ${MAX.shortName} characters.`;
  }

  if (values.organization_type === "") {
    errors.organization_type = "Choose an organization type.";
  }

  if (values.metadata.trim() !== "") {
    const parsed = tryParseMetadata(values.metadata);
    if (parsed.error) errors.metadata = parsed.error;
  }

  return errors;
}

/**
 * Parse the metadata textarea, requiring a JSON *object* (the backend stores
 * a JSONB object and rejects arrays/scalars). An empty block is treated as
 * `{}`, which the model accepts as `blank=True`.
 */
export function tryParseMetadata(raw: string): {
  value?: Record<string, unknown>;
  error?: string;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: "Metadata must be valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Metadata must be a JSON object, for example {}." };
  }

  return { value: parsed as Record<string, unknown> };
}

/**
 * Parent options for the hierarchy select.
 *
 * Excludes the unit being edited and its own descendants so the obvious cycle
 * choices are not offered — but this is a convenience only. The backend's
 * acyclic trigger and `clean()` remain the authority, and any violation it
 * still detects is shown as a `parent` field error.
 */
export function parentOptionsFor(
  nodes: readonly Organization[],
  editing: Organization | null,
): Array<{ value: string; label: string }> {
  const excluded = new Set<number>();
  if (editing) {
    excluded.add(editing.id);
    const childrenOf = new Map<number, number[]>();
    for (const node of nodes) {
      if (node.parent === null) continue;
      const siblings = childrenOf.get(node.parent) ?? [];
      siblings.push(node.id);
      childrenOf.set(node.parent, siblings);
    }
    const stack = [editing.id];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const child of childrenOf.get(current) ?? []) {
        if (excluded.has(child)) continue;
        excluded.add(child);
        stack.push(child);
      }
    }
  }

  return nodes
    .filter((node) => !excluded.has(node.id))
    .map((node) => ({
      value: String(node.id),
      label: `${node.code} — ${node.name}`,
    }));
}
