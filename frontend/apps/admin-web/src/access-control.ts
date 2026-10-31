import { getAccessToken } from "@/access-token";

const endpoint = process.env.API_BASE_URL ?? "http://backend:8000/api";

export async function getEffectivePermissions(siteId?: number): Promise<string[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const query = siteId == null ? "" : `?site=${siteId}`;

  try {
    const response = await fetch(`${endpoint}/v1/authorization/me/permissions/${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("permissions" in payload)) return [];
    const permissions = (payload as { permissions?: unknown }).permissions;
    return Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === "string")
      : [];
  } catch {
    return [];
  }
}
