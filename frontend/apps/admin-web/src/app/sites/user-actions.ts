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
  profile_picture?: string;
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

export async function createSiteUser(siteId: number, form: FormData): Promise<{ok:true;username:string} | {ok:false;message:string;errors:Record<string,string>}> {
  const token = await getAccessToken();
  if (!token) return {ok:false,message:"Your session has expired. Sign in again.",errors:{}};
  const values: Record<string,unknown> = {site:siteId};
  for (const field of ["username","email","password","password_confirmation","role"]) values[field]=String(form.get(field) ?? "");
  const picture=form.get("profile_picture");
  if (picture instanceof File && picture.size) {
    if (picture.size > 2*1024*1024) return {ok:false,message:"Check the profile picture.",errors:{profile_picture:"Choose an image up to 2 MiB."}};
    values.profile_picture=Buffer.from(await picture.arrayBuffer()).toString("base64");
  }
  try {
    const response=await fetch(`${api}/v1/authorization/assignments/site-create-user/`,{method:"POST",cache:"no-store",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(values)});
    const body=await response.json().catch(()=>null);
    if (response.ok) return {ok:true,username:body.user_name};
    const detail=body?.error?.details ?? body;
    const errors:Record<string,string>={};
    if (detail && typeof detail==="object") for (const field of ["username","email","password","password_confirmation","role","profile_picture","site"]) {
      if (detail[field]) errors[field]=Array.isArray(detail[field]) ? detail[field].join(" ") : String(detail[field]);
    }
    return {ok:false,message:response.status===403 ? "You cannot create users for this Site." : response.status===503 ? "Account creation is temporarily unavailable. Please try again." : "Could not create the user. Check the highlighted fields.",errors};
  } catch {
    return {ok:false,message:"Could not confirm account creation. Refresh the directory before retrying.",errors:{}};
  }
}
