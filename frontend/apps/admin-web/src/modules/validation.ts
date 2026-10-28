/**
 * Registry logic shared by the module registry screen and the per-site
 * module configuration screen.
 *
 * Two responsibilities:
 *
 *   1. Typed access to a module's approved `configuration_schema`
 *      (`{schema_version, properties}` — backend module_schema.py), plus
 *      client-side validation and payload building for one Site's settings.
 *      This gives *immediate, usable feedback*; the Django serializer and
 *      `normalize_site_module_configuration` remain the sole authorities and
 *      their 400 answers are rendered verbatim by the caller.
 *
 *   2. Availability messaging. A registry row is a capability announcement,
 *      never proof a feature works: only a module that is IMPLEMENTED *and*
 *      switched on platform-wide may be enabled for a Site, and even then
 *      the backend re-checks it is shipped. Nothing here ever claims CMS,
 *      Staff Directory, Events or any other seeded code is implemented.
 *
 * No credentials or tokens touch this module — it is pure data shaping.
 */
import type { ModuleStatus, PlatformModule } from "@uog/types";

/** One approved property of a module configuration schema. */
export interface ModuleProperty {
  code: string;
  label: string;
  type: "boolean" | "string" | "integer";
  required: boolean;
}

/**
 * Draft value while editing: strings hold raw input (integers are parsed
 * on build), booleans are checkbox state.
 */
export type ModuleSettingValue = string | boolean;

export type ModuleSettings = Record<string, ModuleSettingValue>;

/**
 * Approved properties of a module's schema, or `null` when the document is
 * not in the approved shape. A caller that gets `null` must not offer
 * editing — the shape cannot be typed, so anything sent would be a guess.
 *
 * An empty-but-valid schema (`{}`, the module model's default) yields `[]`:
 * the module simply has no configurable settings.
 */
export function moduleSchemaProperties(
  module: Pick<PlatformModule, "configuration_schema">,
): ModuleProperty[] | null {
  const schema = module.configuration_schema;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  const properties = (schema as { properties?: unknown }).properties ?? [];
  if (!Array.isArray(properties)) return null;

  const approved: ModuleProperty[] = [];
  for (const item of properties) {
    if (typeof item !== "object" || item === null) return null;
    const { code, label, type, required } = item as Record<string, unknown>;
    if (
      typeof code !== "string" ||
      code === "" ||
      typeof label !== "string" ||
      label.trim() === "" ||
      (type !== "boolean" && type !== "string" && type !== "integer") ||
      typeof required !== "boolean"
    ) {
      return null;
    }
    approved.push({ code, label, type, required });
  }
  return approved;
}

/**
 * Seed an editable draft from the assignment's stored configuration. Keys
 * the schema no longer describes are not offered (the backend would reject
 * them as unapproved anyway), and missing optional values start blank/false.
 */
export function settingsFromConfiguration(
  properties: ModuleProperty[],
  configuration: Record<string, unknown> | null | undefined,
): ModuleSettings {
  const stored = configuration ?? {};
  const values: ModuleSettings = {};
  for (const property of properties) {
    const value = stored[property.code];
    if (value === undefined || value === null) {
      values[property.code] = property.type === "boolean" ? false : "";
      continue;
    }
    values[property.code] =
      property.type === "boolean" ? value === true : String(value);
  }
  return values;
}

/**
 * Field errors a client can determine *without* the server — mirrors the
 * documented rules of `normalize_site_module_configuration` for the common
 * cases (required, blank/untrimmed, length, whole numbers). It never claims
 * the server will accept the payload; the server re-validates every write.
 */
export function validateSettings(
  properties: ModuleProperty[],
  values: ModuleSettings,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const property of properties) {
    if (property.type === "boolean") continue; // a checkbox always has a value
    const raw = String(values[property.code] ?? "");
    if (raw.trim() === "") {
      if (property.required) errors[property.code] = "A value is required.";
      continue;
    }
    if (property.type === "string") {
      if (raw !== raw.trim()) {
        errors[property.code] = "Remove the leading or trailing spaces.";
      } else if (raw.length > 500) {
        errors[property.code] = "Use at most 500 characters.";
      }
    } else if (!/^-?\d+$/.test(raw.trim())) {
      errors[property.code] = "Enter a whole number.";
    }
  }
  return errors;
}

/**
 * Build the `configuration` document for create/PATCH. Optional blank
 * strings and integers are omitted (a PATCH replaces the document, so
 * omitting clears them); booleans are always present because their false
 * value is meaningful and they can never be "empty".
 */
export function buildSettingsPayload(
  properties: ModuleProperty[],
  values: ModuleSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const property of properties) {
    if (property.type === "boolean") {
      payload[property.code] = values[property.code] === true;
      continue;
    }
    const raw = String(values[property.code] ?? "");
    if (raw.trim() === "") continue;
    payload[property.code] =
      property.type === "integer"
        ? Number.parseInt(raw.trim(), 10)
        : raw;
  }
  return payload;
}

/** Can this registry row be newly enabled for a Site? Server re-checks. */
export function isModuleAvailable(module: PlatformModule): boolean {
  return module.status === "IMPLEMENTED" && module.is_enabled;
}

export type ModuleAvailability =
  | "available"
  | "planned"
  | "deprecated"
  | "globally-disabled";

export function moduleAvailability(
  module: PlatformModule,
): ModuleAvailability {
  if (module.status === "PLANNED") return "planned";
  if (module.status === "DEPRECATED") return "deprecated";
  return module.is_enabled ? "available" : "globally-disabled";
}

/** Registry status chip, consistent across the registry and site screens. */
export function moduleStatusChip(module: PlatformModule): {
  color: "default" | "success" | "warning";
  label: string;
} {
  switch (module.status) {
    case "IMPLEMENTED":
      return { color: "success", label: "Implemented" };
    case "DEPRECATED":
      return { color: "warning", label: "Deprecated" };
    case "PLANNED":
      return { color: "default", label: "Planned" };
  }
}

/** Can-be-enabled-on-this-site chip: honest about all non-usable rows. */
export function moduleAvailabilityChip(module: PlatformModule): {
  color: "default" | "success";
  label: string;
} {
  return isModuleAvailable(module)
    ? { color: "success", label: "Available" }
    : { color: "default", label: "Unavailable" };
}

/**
 * One-line explanation of *why* a module can or cannot be enabled. Every
 * message states that a registry record is not a working feature where that
 * could otherwise be implied.
 */
export function availabilityMessage(module: PlatformModule): string {
  switch (moduleAvailability(module)) {
    case "available":
      return "Available: implemented and enabled platform-wide, so this site can turn it on. The server still verifies the capability is shipped before accepting the write.";
    case "planned":
      return "Planned: registered but not implemented. It cannot be enabled on any site — a registry row is not a working feature.";
    case "deprecated":
      return "Deprecated: this capability is retired and cannot be newly enabled. Sites that already have it keep their stored settings.";
    case "globally-disabled":
      return "Implemented, but switched off platform-wide: no site can enable it until it is turned on globally.";
  }
}

/** Short human summary of a stored settings document. */
export function settingsSummary(
  configuration: Record<string, unknown> | null | undefined,
): string {
  const entries = Object.entries(configuration ?? {});
  if (entries.length === 0) return "No settings stored";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}`)
    .join(" · ");
}

/** Registry status filter options shared by both screens. */
export const MODULE_STATUS_OPTIONS: ReadonlyArray<{
  value: ModuleStatus | "";
  label: string;
}> = [
  { value: "", label: "All" },
  { value: "PLANNED", label: "Planned" },
  { value: "IMPLEMENTED", label: "Implemented" },
  { value: "DEPRECATED", label: "Deprecated" },
];
