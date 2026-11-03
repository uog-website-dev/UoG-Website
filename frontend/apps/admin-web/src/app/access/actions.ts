"use server";

import { ApiError, apiErrorFromResponse, createApiClient } from "@uog/api-client";
import type {
  AssignmentAuditEvent,
  AssignmentCreateInput,
  AssignmentListQuery,
  CallerAccess,
  EffectiveAccess,
  PaginatedResponse,
  PlatformUser,
  UserAssignment,
  UserSearchQuery,
} from "@uog/types";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult, ApiErrorPayload } from "@/organizations/contract";

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

export interface AccessScopeSelection {
  scope: "PLATFORM" | "ORGANIZATION" | "SITE";
  organization?: number;
  site?: number;
}

export interface EffectiveGrant {
  user: number;
  organization: number | null;
  site: number | null;
  permissions: string[];
}

/** A section is ready only after a successful, readable payload. Failures stay errors. */
export type AccessSection<T> =
  | { status: "ready"; data: T }
  | { status: "error"; error: ApiErrorPayload };

export interface AccessControlData {
  permissions: AccessSection<PermissionDefinition[]>;
  roles: AccessSection<RoleDefinition[]>;
  assignments: AccessSection<AssignmentDefinition[]>;
  effective: AccessSection<string[]>;
  callerUserId: number | null;
}

type Call<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; error: ApiErrorPayload };

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

function signInRequired(): ApiErrorPayload {
  return {
    status: 401,
    code: "not_authenticated",
    message: "Sign in is required.",
    details: null,
    requestId: null,
  };
}

function invalidResponse(label: string, requestId: string | null): ApiErrorPayload {
  return {
    status: 200,
    code: "invalid_response",
    message: `${label} returned a response the console cannot read.`,
    details: null,
    requestId,
  };
}

function validationFailure(message: string): ApiErrorPayload {
  return {
    status: 400,
    code: "validation_error",
    message,
    details: null,
    requestId: null,
  };
}

function unsupported(action: string): ActionResult<never> {
  return {
    ok: false,
    error: {
      status: 501,
      code: "not_implemented",
      message:
        `${action} is not provided by the authorization API. ` +
        "Use the registered permission, role, and assignment endpoints on this page.",
      details: null,
      requestId: null,
    },
  };
}

async function send(path: string, method = "GET", body?: unknown): Promise<Call<unknown>> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: signInRequired() };
  const requestId = crypto.randomUUID();
  try {
    if (method === "GET" || method === "POST") {
      const api = createApiClient({
        baseUrl: apiBaseUrl(),
        accessToken: token,
        requestIdFactory: () => requestId,
      });
      const result = method === "GET"
        ? await api.getDetailed<unknown>(path)
        : await api.postDetailed<unknown>(path, body);
      return { ok: true, data: result.data, requestId: result.requestId };
    }

    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    if (!response.ok) throw await apiErrorFromResponse(response, requestId);
    const echoed = response.headers.get("X-Request-ID") ?? requestId;
    const text = await response.text();
    if (!text) return { ok: true, data: null, requestId: echoed };
    try {
      return { ok: true, data: JSON.parse(text) as unknown, requestId: echoed };
    } catch {
      return { ok: false, error: invalidResponse("The authorization API", echoed) };
    }
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<ActionResult<T>> {
  const result = await send(path, method, body);
  if (!result.ok) return result;
  return { ok: true, data: result.data as T };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asPage<T>(data: unknown, label: string, requestId: string | null): Call<{ results: T[]; next: string | null }> {
  if (Array.isArray(data)) {
    return { ok: true, data: { results: data as T[], next: null }, requestId };
  }
  const record = asRecord(data);
  if (record && Array.isArray(record.results)) {
    const next = record.next;
    if (next !== null && next !== undefined && typeof next !== "string") {
      return { ok: false, error: invalidResponse(label, requestId) };
    }
    return {
      ok: true,
      data: { results: record.results as T[], next: next ?? null },
      requestId,
    };
  }
  return { ok: false, error: invalidResponse(label, requestId) };
}

async function collect<T>(path: string, label: string): Promise<AccessSection<T[]>> {
  const first = await send(path);
  if (!first.ok) return { status: "error", error: first.error };
  const page = asPage<T>(first.data, label, first.requestId);
  if (!page.ok) return { status: "error", error: page.error };
  const rows = [...page.data.results];
  let next = page.data.next;
  const root = path.split("?")[0];
  for (let guard = 0; next && guard < 49; guard += 1) {
    let search: string;
    try {
      search = new URL(next, "http://admin.local").search;
    } catch {
      return { status: "error", error: invalidResponse(label, first.requestId) };
    }
    const more = await send(`${root}${search}`);
    if (!more.ok) return { status: "error", error: more.error };
    const nextPage = asPage<T>(more.data, label, more.requestId);
    if (!nextPage.ok) return { status: "error", error: nextPage.error };
    rows.push(...nextPage.data.results);
    next = nextPage.data.next;
  }
  return { status: "ready", data: rows };
}

function positive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function callerPermissionsPath(scope: AccessScopeSelection): string | ApiErrorPayload {
  if (scope.scope === "PLATFORM") return "/v1/authorization/me/permissions/";
  if (scope.scope === "ORGANIZATION") {
    if (!positive(scope.organization)) return validationFailure("Enter the organization to inspect.");
    return `/v1/authorization/me/permissions/?organization=${scope.organization}`;
  }
  if (!positive(scope.site)) return validationFailure("Enter the site to inspect.");
  const params = new URLSearchParams({ site: String(scope.site) });
  if (scope.organization !== undefined) {
    if (!positive(scope.organization)) return validationFailure("Enter the organization that owns the site, or leave it blank.");
    params.set("organization", String(scope.organization));
  }
  return `/v1/authorization/me/permissions/?${params.toString()}`;
}

function userPermissionsPath(userId: number, scope: AccessScopeSelection): string | ApiErrorPayload {
  if (!positive(userId)) return validationFailure("Enter a valid user ID to inspect.");
  const params = new URLSearchParams({ scope: scope.scope });
  if (scope.scope === "ORGANIZATION") {
    if (!positive(scope.organization)) return validationFailure("Enter the organization to inspect.");
    params.set("organization", String(scope.organization));
  }
  if (scope.scope === "SITE") {
    if (!positive(scope.site)) return validationFailure("Enter the site to inspect.");
    params.set("site", String(scope.site));
    if (scope.organization !== undefined) {
      if (!positive(scope.organization)) return validationFailure("Enter the organization that owns the site, or leave it blank.");
      params.set("organization", String(scope.organization));
    }
  }
  return `/v1/authorization/assignments/users/${userId}/effective/?${params.toString()}`;
}

function asEffectiveGrant(data: unknown, requestId: string | null): Call<EffectiveGrant> {
  const record = asRecord(data);
  const permissions = record?.permissions;
  if (
    !record
    || typeof record.user !== "number"
    || !Array.isArray(permissions)
    || permissions.some((code) => typeof code !== "string")
  ) {
    return { ok: false, error: invalidResponse("Effective permissions", requestId) };
  }
  return {
    ok: true,
    requestId,
    data: {
      user: record.user,
      organization: typeof record.organization === "number" ? record.organization : null,
      site: typeof record.site === "number" ? record.site : null,
      permissions: permissions as string[],
    },
  };
}

export async function getAccessControlData(
  scope: AccessScopeSelection = { scope: "PLATFORM" },
): Promise<AccessControlData> {
  try {
    const permissionPath = callerPermissionsPath(scope);
    const [permissions, roles, assignments, effectiveCall] = await Promise.all([
      collect<PermissionDefinition>("/v1/authorization/permissions/", "The permission catalog"),
      collect<RoleDefinition>("/v1/authorization/roles/", "The role catalog"),
      collect<AssignmentDefinition>("/v1/authorization/assignments/", "Role assignments"),
      typeof permissionPath === "string" ? send(permissionPath) : Promise.resolve({ ok: false as const, error: permissionPath }),
    ]);
    if (!effectiveCall.ok) {
      return { permissions, roles, assignments, effective: { status: "error", error: effectiveCall.error }, callerUserId: null };
    }
    const grant = asEffectiveGrant(effectiveCall.data, effectiveCall.requestId);
    if (!grant.ok) {
      return { permissions, roles, assignments, effective: { status: "error", error: grant.error }, callerUserId: null };
    }
    return {
      permissions,
      roles,
      assignments,
      effective: { status: "ready", data: grant.data.permissions },
      callerUserId: grant.data.user,
    };
  } catch (cause) {
    const error = cause instanceof ApiError
      ? serializeApiError(cause)
      : serializeApiError(cause);
    const failed: AccessSection<never[]> = { status: "error", error };
    return {
      permissions: failed,
      roles: failed,
      assignments: failed,
      effective: failed,
      callerUserId: null,
    };
  }
}

export async function getUserEffectivePermissions(
  userId: number,
  scope: AccessScopeSelection,
): Promise<ActionResult<EffectiveGrant>> {
  const path = userPermissionsPath(userId, scope);
  if (typeof path !== "string") return { ok: false, error: path };
  const result = await send(path);
  if (!result.ok) return result;
  const grant = asEffectiveGrant(result.data, result.requestId);
  if (!grant.ok) return grant;
  return { ok: true, data: grant.data };
}

export async function createRole(input: { code: string; name: string; description: string }): Promise<ActionResult<RoleDefinition>> {
  return request("/v1/authorization/roles/", "POST", input);
}

export async function updateRole(code: string, input: { name?: string; description?: string; is_active?: boolean }): Promise<ActionResult<RoleDefinition>> {
  return request(`/v1/authorization/roles/${encodeURIComponent(code)}/`, "PATCH", input);
}

export async function replaceRolePermissions(code: string, permissions: string[]): Promise<ActionResult<{ permissions: string[] }>> {
  return request(`/v1/authorization/roles/${encodeURIComponent(code)}/permissions/`, "PUT", { permissions });
}

export async function assignRole(input: {
  user: number;
  role: number;
  scope: "PLATFORM" | "ORGANIZATION" | "SITE";
  organization?: number;
  site?: number;
  expires_at?: string | null;
}): Promise<ActionResult<AssignmentDefinition>> {
  return request("/v1/authorization/assignments/", "POST", input);
}

export async function revokeRoleAssignment(id: number): Promise<ActionResult<AssignmentDefinition>> {
  return request(`/v1/authorization/assignments/${id}/revoke/`, "POST", {});
}

/**
 * Names imported by the unmounted access screen. That screen describes a
 * user-lookup contract this API does not serve. These exports fail explicitly
 * so a missing route cannot be presented as an empty grant list.
 */
export async function searchUsers(
  _query: UserSearchQuery = {},
): Promise<ActionResult<PaginatedResponse<PlatformUser>>> {
  return unsupported("User search");
}

export async function getCallerAccess(): Promise<ActionResult<CallerAccess>> {
  return unsupported("Caller access lookup");
}

export async function getEffectiveAccess(_userId: string): Promise<ActionResult<EffectiveAccess>> {
  return unsupported("Subject effective-access lookup");
}

export async function listAssignments(
  _query: AssignmentListQuery = {},
): Promise<ActionResult<PaginatedResponse<UserAssignment>>> {
  return unsupported("Subject assignment lookup");
}

export async function listAssignmentAudit(): Promise<ActionResult<PaginatedResponse<AssignmentAuditEvent>>> {
  return unsupported("Assignment audit lookup");
}

export async function revokeAssignment(_id: number): Promise<ActionResult<void>> {
  return unsupported("Subject assignment revocation");
}

export async function createAssignment(
  _input: AssignmentCreateInput,
): Promise<ActionResult<UserAssignment>> {
  return unsupported("Subject assignment creation");
}
