/**
 * Wire types and display helpers for central module management.
 *
 * Mirrors backend `apps/sites/api/module_management.py`. Activation state is
 * always read from the backend; nothing here decides eligibility. Labels are
 * only presentation for the reasons and states the server reports.
 */
import type { ModuleStatus, Organization, SiteStatus } from "@uog/types";

export type ModuleAction = "ENABLE" | "DISABLE";
export type ActivationState = "ENABLED" | "DISABLED" | "NOT_ASSIGNED";
export type PairOutcome = "CHANGE" | "UNCHANGED" | "BLOCKED";
export type SiteOutcome = PairOutcome | "PARTIAL";
export type ImplementationStatus = "AVAILABLE" | "PLANNED" | "DEPRECATED" | "IMPLEMENTED_DISABLED";
export type ScopeType = "SITE" | "SELECTED" | "ALL" | "FILTER" | "ORGANIZATION";

export interface ModuleActivationSummary {
  id: number;
  code: string;
  name: string;
  description: string;
  status: ModuleStatus;
  implementation_status: ImplementationStatus;
  is_shipped: boolean;
  platform_enabled: boolean;
  enabled_sites: number;
  disabled_sites: number;
  eligible_sites: number;
  total_sites: number;
  requires: string[];
  required_by: string[];
  updated_at: string;
}

export interface SiteFilters {
  search?: string;
  status?: SiteStatus;
  organization?: number;
  include_descendants?: boolean;
  site?: number;
  module?: string;
  activation?: ActivationState;
}

export interface SiteActivationRow {
  id: number;
  code: string;
  name: string;
  status: SiteStatus;
  organization: { id: number; code: string; name: string };
  modules: Record<string, Exclude<ActivationState, "NOT_ASSIGNED">>;
}

export interface OperationScope {
  type: ScopeType;
  site_ids?: number[];
  organization?: number;
  include_descendants?: boolean;
  filters?: SiteFilters;
}

export interface PreviewRequest {
  action: ModuleAction;
  modules: string[];
  scope: OperationScope;
}

export interface PreviewReason {
  code: string;
  message: string;
  module?: string;
}

export interface PreviewPair {
  code: string;
  previous_state: ActivationState;
  new_state: ActivationState;
  outcome: PairOutcome;
  reasons: PreviewReason[];
}

export interface PreviewSite {
  id: number;
  code: string;
  name: string;
  status: SiteStatus;
  organization: { id: number; name: string };
  outcome: SiteOutcome;
  modules: PreviewPair[];
}

export interface PreviewSummary {
  matched_sites: number;
  eligible_sites: number;
  already_in_state_sites: number;
  blocked_sites: number;
  expected_changes: number;
  unchanged_pairs: number;
  blocked_pairs: number;
  blocked_reasons: Array<{ code: string; count: number; message: string }>;
}

export interface OperationPreview {
  action: ModuleAction;
  modules: Array<{ code: string; name: string; implementation_status: ImplementationStatus }>;
  scope: OperationScope;
  summary: PreviewSummary;
  dependency_warnings: Array<{ module: string; message: string }>;
  high_impact: boolean;
  confirmation_phrase: string;
  sites: PreviewSite[];
  preview_token: string;
  expires_in: number;
}

export interface OperationChange {
  site: number;
  site_code: string;
  site_name: string;
  module: string;
  previous_state: ActivationState;
  new_state: ActivationState;
}

export interface ModuleOperation {
  id: string;
  action: ModuleAction;
  module_codes: string[];
  scope_type: ScopeType;
  scope: OperationScope;
  reason: string;
  actor: { id: string; username: string };
  request_id: string | null;
  matched_count: number;
  changed_site_count: number;
  unchanged_count: number;
  blocked_count: number;
  change_count: number;
  created_at: string;
}

export interface ModuleOperationDetail extends ModuleOperation {
  changes: OperationChange[];
}

export interface ApplyResult {
  replayed: boolean;
  operation: ModuleOperationDetail;
}

export interface ApplyRequest {
  previewToken: string;
  idempotencyKey: string;
  reason: string;
  confirmation: string;
}

export interface OperationListQuery {
  action?: ModuleAction;
  module?: string;
  site?: number;
  page?: number;
}

export const IMPLEMENTATION_LABELS: Record<ImplementationStatus, { label: string; color: "success" | "default" | "warning" | "info" }> = {
  AVAILABLE: { label: "Available", color: "success" },
  PLANNED: { label: "Planned", color: "default" },
  DEPRECATED: { label: "Deprecated", color: "warning" },
  IMPLEMENTED_DISABLED: { label: "Implemented but disabled", color: "info" },
};

export const STATE_LABELS: Record<ActivationState, string> = {
  ENABLED: "Enabled",
  DISABLED: "Disabled",
  NOT_ASSIGNED: "Not assigned",
};

export const OUTCOME_LABELS: Record<SiteOutcome, string> = {
  CHANGE: "Will change",
  UNCHANGED: "Already in state",
  BLOCKED: "Blocked",
  PARTIAL: "Partly blocked",
};

export const ACTION_LABELS: Record<ModuleAction, { verb: string; past: string }> = {
  ENABLE: { verb: "Enable", past: "Enabled" },
  DISABLE: { verb: "Disable", past: "Disabled" },
};

export const SITE_STATUS_OPTIONS: Array<{ value: SiteStatus; label: string }> = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ARCHIVED", label: "Archived" },
];

export const ACTIVATION_OPTIONS: Array<{ value: ActivationState; label: string }> = [
  { value: "ENABLED", label: "Enabled" },
  { value: "DISABLED", label: "Disabled" },
  { value: "NOT_ASSIGNED", label: "Not assigned" },
];

export function implementationLabel(status: ImplementationStatus) {
  return IMPLEMENTATION_LABELS[status] ?? { label: status, color: "default" as const };
}

/** Only filters the backend accepts, with blanks dropped. */
export function cleanFilters(filters: SiteFilters): SiteFilters {
  const cleaned: SiteFilters = {};
  if (filters.search?.trim()) cleaned.search = filters.search.trim();
  if (filters.status) cleaned.status = filters.status;
  if (filters.organization) {
    cleaned.organization = filters.organization;
    if (filters.include_descendants) cleaned.include_descendants = true;
  }
  if (filters.site) cleaned.site = filters.site;
  if (filters.module) cleaned.module = filters.module;
  if (filters.module && filters.activation) cleaned.activation = filters.activation;
  return cleaned;
}

export function hasFilters(filters: SiteFilters): boolean {
  return Object.keys(cleanFilters(filters)).length > 0;
}

/** Organizations in tree order with depth, for an indented picker. */
export function organizationOptions(units: Organization[]): Array<{ value: number; label: string; depth: number }> {
  const children = new Map<number | null, Organization[]>();
  for (const unit of units) {
    const siblings = children.get(unit.parent) ?? [];
    siblings.push(unit);
    children.set(unit.parent, siblings);
  }
  const known = new Set(units.map((unit) => unit.id));
  const roots = units.filter((unit) => unit.parent === null || !known.has(unit.parent));
  const options: Array<{ value: number; label: string; depth: number }> = [];
  const visit = (unit: Organization, depth: number) => {
    options.push({ value: unit.id, label: unit.name, depth });
    for (const child of (children.get(unit.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots.sort((a, b) => a.name.localeCompare(b.name))) visit(root, 0);
  return options;
}

export function describeScope(scope: OperationScope, organizationName?: (id: number) => string | undefined): string {
  switch (scope.type) {
    case "SITE":
      return "One Site";
    case "SELECTED":
      return `${scope.site_ids?.length ?? 0} selected Sites`;
    case "ALL":
      return "All Sites";
    case "FILTER":
      return "All Sites matching filters";
    case "ORGANIZATION": {
      const name = (scope.organization && organizationName?.(scope.organization)) || `Organization ${scope.organization}`;
      return scope.include_descendants ? `${name} and its descendants` : `${name} (direct Sites only)`;
    }
  }
}

/** Short reason code for a rejected apply, read from the error envelope. */
export function rejectionReason(details: unknown): string | null {
  if (details && typeof details === "object" && "reason" in details) {
    const reason = (details as { reason: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

export function rejectionMessage(details: unknown): string | null {
  if (details && typeof details === "object" && "message" in details) {
    const message = (details as { message: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
