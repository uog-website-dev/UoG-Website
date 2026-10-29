"use server";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";

export interface PermissionDefinition {
  id: number;
  code: string;
  name: string;
  description: string;
  module: string;
  resource_type: string;
  action: string;
  risk: string;
  delegable: boolean;
  is_system: boolean;
  is_active: boolean;
}

export interface RoleDefinition {
  id: number;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
}

export interface AssignmentDefinition {
  id: number;
  user: number;
  user_name: string;
  role: number;
  role_name: string;
  scope: "PLATFORM" | "ORGANIZATION" | "SITE";
  organization: number | null;
  site: number | null;
  assigned_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

async function request<T>(path: string, init?: RequestInit): Promise<ActionResult<T>> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return {
        ok: false,
        error: { status: 401, code: "not_authenticated", message: "Sign in is required.", details: null, requestId: null },
      };
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const detail = typeof payload.detail === "string" ? payload.detail : "The authorization request was rejected.";
      return {
        ok: false,
        error: {
          status: response.status,
          code: typeof payload.code === "string" ? payload.code : "api_error",
          message: detail,
          details: payload,
          requestId: typeof response.headers.get("x-request-id") === "string" ? response.headers.get("x-request-id") : null,
        },
      };
    }
    return { ok: true, data: body as T };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

export async function getAccessControlData(): Promise<{
  permissions: PermissionDefinition[];
  roles: RoleDefinition[];
  assignments: AssignmentDefinition[];
  effective: string[];
  errors: string[];
}> {
  const [permissionsResult, rolesResult, assignmentsResult] = await Promise.all([
    request<PermissionDefinition[] | { results: PermissionDefinition[] }>("/v1/authorization/permissions/"),
    request<{ results: RoleDefinition[] }>("/v1/authorization/roles/"),
    request<{ results: AssignmentDefinition[]; next: string | null }>("/v1/authorization/assignments/"),
  ]);
  const assignments = assignmentsResult.ok ? [...assignmentsResult.data.results] : [];
  let nextAssignmentPage = assignmentsResult.ok ? assignmentsResult.data.next : null;
  for (let page = 0; nextAssignmentPage && page < 49; page += 1) {
    const nextUrl = new URL(nextAssignmentPage, "http://admin.local");
    const nextResult = await request<{ results: AssignmentDefinition[]; next: string | null }>(
      `/v1/authorization/assignments/${nextUrl.search}`,
    );
    if (!nextResult.ok) break;
    assignments.push(...nextResult.data.results);
    nextAssignmentPage = nextResult.data.next;
  }
  const scopeQueries = new Map<string, string>();
  for (const assignment of assignments) {
    if (assignment.revoked_at) continue;
    if (assignment.scope === "PLATFORM") scopeQueries.set("platform", "");
    else if (assignment.scope === "ORGANIZATION" && assignment.organization !== null) {
      scopeQueries.set(`organization:${assignment.organization}`, `?organization=${assignment.organization}`);
    } else if (assignment.scope === "SITE" && assignment.site !== null) {
      scopeQueries.set(`site:${assignment.site}`, `?site=${assignment.site}`);
    }
  }
  const effectiveResults = await Promise.all(
    [...scopeQueries.values()].map((query) =>
      request<{ permissions: string[] }>(`/v1/authorization/me/permissions/${query}`),
    ),
  );
  const effective = new Set<string>();
  for (const result of effectiveResults) {
    if (result.ok) result.data.permissions.forEach((code) => effective.add(code));
  }
  return {
    permissions: permissionsResult.ok
      ? Array.isArray(permissionsResult.data) ? permissionsResult.data : permissionsResult.data.results
      : [],
    roles: rolesResult.ok ? rolesResult.data.results : [],
    assignments,
    effective: [...effective],
    errors: [permissionsResult, rolesResult, assignmentsResult, ...effectiveResults]
      .filter((result) => !result.ok)
      .map((result) => result.error.message),
  };
}

export async function createRole(input: { code: string; name: string; description: string }): Promise<ActionResult<RoleDefinition>> {
  return request("/v1/authorization/roles/", { method: "POST", body: JSON.stringify(input) });
}

export async function updateRole(code: string, input: { name?: string; description?: string; is_active?: boolean }): Promise<ActionResult<RoleDefinition>> {
  return request(`/v1/authorization/roles/${encodeURIComponent(code)}/`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function replaceRolePermissions(code: string, permissions: string[]): Promise<ActionResult<{ permissions: string[] }>> {
  return request(`/v1/authorization/roles/${encodeURIComponent(code)}/permissions/`, { method: "PUT", body: JSON.stringify({ permissions }) });
}

export async function assignRole(input: {
  user: number;
  role: number;
  scope: "PLATFORM" | "ORGANIZATION" | "SITE";
  organization?: number;
  site?: number;
  expires_at?: string | null;
}): Promise<ActionResult<AssignmentDefinition>> {
  return request("/v1/authorization/assignments/", { method: "POST", body: JSON.stringify(input) });
}

export async function revokeRoleAssignment(id: number): Promise<ActionResult<AssignmentDefinition>> {
  return request(`/v1/authorization/assignments/${id}/revoke/`, { method: "POST", body: "{}" });
}
