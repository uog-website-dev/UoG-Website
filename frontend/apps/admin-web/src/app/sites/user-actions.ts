"use server";

import { getAccessToken } from "@/access-token";

const api = process.env.API_BASE_URL ?? "http://backend:8000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Sign in again.");
  const response = await fetch(`${api}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? String(body.detail) : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  return body as T;
}

export interface SiteAssignment {
  id: number;
  user: number;
  user_name: string;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
  role: number;
  role_name: string;
  assigned_at: string;
  revoked_at: string | null;
}
export interface SiteDirectoryUser {
  user: number;
  user_name: string;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
  assignments: SiteAssignment[];
}
export interface SiteIdentity { id: number; username: string; email: string; first_name: string; last_name: string; assigned_role_ids: number[] }
export interface SiteRole { id: number; code: string; name: string; permissions: string[]; assignable: boolean }
export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }

export async function getSiteUsers(siteId: number, search = "", page = 1, role = "", ordering = "name") {
  return request<Page<SiteDirectoryUser>>(`/v1/authorization/assignments/site-users/?site=${siteId}&search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}&ordering=${ordering}&page=${page}`);
}
export async function searchSiteUsers(siteId: number, search: string) {
  return request<SiteIdentity[]>(`/v1/authorization/assignments/site-user-search/?site=${siteId}&search=${encodeURIComponent(search)}`);
}
export async function getSiteRoles(siteId: number) {
  return request<SiteRole[]>(`/v1/authorization/assignments/site-roles/?site=${siteId}`);
}
export async function assignSiteRole(siteId: number, organizationId: number, userId: number, roleId: number) {
  return request<SiteAssignment>("/v1/authorization/assignments/", {
    method: "POST",
    body: JSON.stringify({ user: userId, role: roleId, scope: "SITE", site: siteId, organization: organizationId }),
  });
}
export async function revokeSiteRole(assignmentId: number) {
  return request<SiteAssignment>(`/v1/authorization/assignments/${assignmentId}/revoke/`, { method: "POST", body: "{}" });
}
