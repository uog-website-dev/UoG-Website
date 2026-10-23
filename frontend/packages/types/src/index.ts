/**
 * Shared API/domain types for the UoG Digital Platform.
 *
 * Mirrors the Django REST Framework schemas exposed by the backend
 * (see backend/apps/api). Extend here as new resources land.
 */

/** A CMS page (sample resource proving backend <-> frontend contracts). */
export interface Page {
  id: number;
  title: string;
  slug: string;
  content: string;
  description: string;
  created_at: string;
  updated_at: string;
  is_published: boolean;
}

/** Standard DRF page-number envelope. */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Identity behind a validated Keycloak access token (GET /api/me/). */
export interface Identity {
  username: string;
  email: string;
  name: string;
  roles: string[];
  is_staff: boolean;
  client_id: string;
  scopes: string[];
  expires_at: number;
}

/** Platform overview for administrators (GET /api/admin/overview/). */
export interface AdminOverview {
  pages: number;
  published_pages: number;
  users: number;
  requested_by: string;
}

/** Backend readiness report (GET /health/ready). */
export type HealthState = "ok" | "unavailable";

export interface HealthCheck {
  status: string;
  latency_ms?: number;
  detail?: string;
}

export interface HealthReport {
  status: HealthState;
  checks: Record<string, HealthCheck>;
}
