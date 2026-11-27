export interface SiteEventSettings {
  timezone: string;
  public_list_path: string;
  registration_required_by_default: boolean;
  registration_default_capacity: number | null;
  public_aggregation_eligible: boolean;
}

export interface SiteEventCategory {
  id: string;
  code: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  is_active: boolean;
  locale: string;
  created_at?: string;
  updated_at?: string;
}

export function defaultSiteEventSettings(): SiteEventSettings {
  return {
    timezone: "Africa/Addis_Ababa",
    public_list_path: "/events",
    registration_required_by_default: false,
    registration_default_capacity: null,
    public_aggregation_eligible: false,
  };
}

export function eventSettingsFrom(value: unknown): SiteEventSettings {
  const result = defaultSiteEventSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const row = value as Record<string, unknown>;
  if (typeof row.timezone === "string" && row.timezone.trim()) result.timezone = row.timezone.trim();
  if (typeof row.public_list_path === "string" && row.public_list_path.trim()) {
    result.public_list_path = row.public_list_path.trim();
  }
  if (typeof row.registration_required_by_default === "boolean") {
    result.registration_required_by_default = row.registration_required_by_default;
  }
  if (row.registration_default_capacity === null) {
    result.registration_default_capacity = null;
  } else if (typeof row.registration_default_capacity === "number" && Number.isInteger(row.registration_default_capacity) && row.registration_default_capacity >= 1) {
    result.registration_default_capacity = row.registration_default_capacity;
  }
  if (typeof row.public_aggregation_eligible === "boolean") {
    result.public_aggregation_eligible = row.public_aggregation_eligible;
  }
  return result;
}
