export type StaffDirectorySort = "NAME_ASC" | "NAME_DESC" | "TITLE_ASC" | "DEPARTMENT_ASC";
export type StaffDirectoryPresentation = "LIST" | "CARDS";

export interface SiteStaffDirectorySettings {
  page_size: number;
  default_sort: StaffDirectorySort;
  public_list_path: string;
  presentation: StaffDirectoryPresentation;
  public_aggregation_eligible: boolean;
}

export interface StaffDirectoryScope {
  organization_unit_id: number | null;
  organization_ids: number[];
  mode: "mapped_organization" | "main_with_eligible_aggregation" | string;
  aggregation_site_ids: number[];
}

const SORTS: readonly StaffDirectorySort[] = ["NAME_ASC", "NAME_DESC", "TITLE_ASC", "DEPARTMENT_ASC"];
const PRESENTATIONS: readonly StaffDirectoryPresentation[] = ["LIST", "CARDS"];

export function defaultSiteStaffDirectorySettings(): SiteStaffDirectorySettings {
  return {
    page_size: 20,
    default_sort: "NAME_ASC",
    public_list_path: "/staff",
    presentation: "LIST",
    public_aggregation_eligible: false,
  };
}

export function staffDirectorySettingsFrom(value: unknown): SiteStaffDirectorySettings {
  const result = defaultSiteStaffDirectorySettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const row = value as Record<string, unknown>;
  if (typeof row.page_size === "number" && Number.isInteger(row.page_size) && row.page_size >= 5 && row.page_size <= 100) {
    result.page_size = row.page_size;
  }
  if (typeof row.default_sort === "string" && (SORTS as readonly string[]).includes(row.default_sort)) {
    result.default_sort = row.default_sort as StaffDirectorySort;
  }
  if (typeof row.public_list_path === "string" && row.public_list_path.trim()) {
    result.public_list_path = row.public_list_path.trim();
  }
  if (typeof row.presentation === "string" && (PRESENTATIONS as readonly string[]).includes(row.presentation)) {
    result.presentation = row.presentation as StaffDirectoryPresentation;
  }
  if (typeof row.public_aggregation_eligible === "boolean") {
    result.public_aggregation_eligible = row.public_aggregation_eligible;
  }
  return result;
}
