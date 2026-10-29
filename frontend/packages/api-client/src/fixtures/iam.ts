/**
 * Mock fixtures for the User Assignment & Access Management screens.
 *
 * Every fixture mirrors a real serialized response from the platform API
 * contract (users lookup, assignments, effective permissions, audit — see
 * ../adapters/iam.ts): field names, scope codes, role names and timestamp
 * format are identical to what the live adapter parses, so swapping the mock
 * for the live adapter requires no screen changes.
 *
 * These are fixtures for local development only — the live adapter never
 * returns them, and a production build refuses mock mode outright
 * (see ../adapters/mode.ts), so nothing here can be mistaken for real data
 * in a deployed integration.
 */
import type {
  AssignmentAuditEvent,
  EffectivePermission,
  PlatformRole,
  PlatformUser,
  UserAssignment,
} from "@uog/types";

import { organizationFixtures } from "./organizations";
import { siteFixtures } from "./sites";

/**
 * Role catalogue: the realm roles infrastructure/keycloak/keycloak-init.py
 * creates, with the description Keycloak itself shows. Order is weakest to
 * strongest so screens can present a predictable list.
 */
export const ROLE_CATALOG: ReadonlyArray<{ code: PlatformRole; label: string; description: string }> =
  [
    {
      code: "platform-viewer",
      label: "Platform viewer",
      description: "Read-only access to the administration console.",
    },
    {
      code: "platform-editor",
      label: "Platform editor",
      description: "May create and publish content, but not manage organizations or sites.",
    },
    {
      code: "platform-admin",
      label: "Platform administrator",
      description: "Full administrative access to the platform (organizations, sites, content).",
    },
  ];

/**
 * Permission keys each role confers, per scope.
 *
 * The live adapter never uses this table: it renders whatever the backend
 * answers for GET /users/{id}/access/. It exists so the mock can exercise
 * the effective-permissions summary with a shape the console expects, and
 * it mirrors the console's own capability map (what each role may reach).
 */
const ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  "platform-viewer": ["console.read", "organizations.read", "sites.read"],
  "platform-editor": [
    "console.read",
    "organizations.read",
    "organizations.write",
    "sites.read",
    "sites.write",
  ],
  "platform-admin": [
    "console.read",
    "organizations.read",
    "organizations.write",
    "sites.read",
    "sites.write",
    "domains.write",
    "modules.write",
    "access.manage",
  ],
};

/**
 * Fixture users, shaped to exercise the console's states: an enabled
 * administrator, a site-scoped editor, a read-only viewer, and a disabled
 * account that must display as such rather than being hidden.
 *
 * `id` is the Keycloak subject (`sub`), which stays stable when a username
 * changes — assignments follow the subject, never the display name.
 */
export const userFixtures: PlatformUser[] = [
  {
    id: "sub-0001-devuser",
    username: "devuser",
    email: "devuser@uog.et",
    first_name: "Development",
    last_name: "User",
    enabled: true,
  },
  {
    id: "sub-0002-alemayehu",
    username: "alemayehu",
    email: "alemayehu.t@uog.et",
    first_name: "Alemayehu",
    last_name: "Tesfaye",
    enabled: true,
  },
  {
    id: "sub-0003-sara",
    username: "sara",
    email: "sara.b@uog.et",
    first_name: "Sara",
    last_name: "Bekele",
    enabled: true,
  },
  {
    id: "sub-0004-former-staff",
    username: "former.staff",
    email: "former.staff@uog.et",
    first_name: "Former",
    last_name: "Staff",
    enabled: false,
  },
];

function siteLabel(id: number): string {
  const site = siteFixtures.find((fixture) => fixture.id === id);
  return site ? `${site.name} (${site.code})` : `Site ${id}`;
}

function organizationLabel(id: number): string {
  const organization = organizationFixtures.find((fixture) => fixture.id === id);
  return organization ? `${organization.name} (${organization.code})` : `Organization ${id}`;
}

/**
 * Fixture assignments: one platform-wide administrator, one Site-scoped
 * editor (proving a grant is bound to a scope), one platform-wide viewer,
 * and a second Site grant on the *same* user so the list shows several
 * scoped grants for one account.
 */
export const assignmentFixtures: UserAssignment[] = [
  {
    id: 101,
    user_id: "sub-0001-devuser",
    username: "devuser",
    role: "platform-admin",
    scope_type: "PLATFORM",
    scope_id: null,
    scope_label: "Whole platform",
    created_at: "2026-10-20T08:15:00.000000Z",
    created_by: "uog_admin",
  },
  {
    id: 102,
    user_id: "sub-0002-alemayehu",
    username: "alemayehu",
    role: "platform-editor",
    scope_type: "SITE",
    scope_id: 1,
    scope_label: siteLabel(1),
    created_at: "2026-10-21T10:05:00.000000Z",
    created_by: "devuser",
  },
  {
    id: 103,
    user_id: "sub-0002-alemayehu",
    username: "alemayehu",
    role: "platform-editor",
    scope_type: "ORGANIZATION",
    scope_id: 2,
    scope_label: organizationLabel(2),
    created_at: "2026-10-22T14:40:00.000000Z",
    created_by: "devuser",
  },
  {
    id: 104,
    user_id: "sub-0003-sara",
    username: "sara",
    role: "platform-viewer",
    scope_type: "PLATFORM",
    scope_id: null,
    scope_label: "Whole platform",
    created_at: "2026-10-23T09:30:00.000000Z",
    created_by: "devuser",
  },
];

/** Fixture audit trail for the access-management screens (newest first). */
export const auditEventFixtures: AssignmentAuditEvent[] = [
  {
    id: 9003,
    action: "assignment.created",
    entity_type: "UserAssignment",
    entity_id: "104",
    actor_kind: "USER",
    actor_id: "devuser",
    timestamp: "2026-10-23T09:30:00.000000Z",
    request_id: "6f1c8a1e-2f4b-4f0e-9a4a-5f5c0e1b7d21",
  },
  {
    id: 9002,
    action: "assignment.created",
    entity_type: "UserAssignment",
    entity_id: "103",
    actor_kind: "USER",
    actor_id: "devuser",
    timestamp: "2026-10-22T14:40:00.000000Z",
    request_id: "b2d7a0f3-9c31-4d2f-8f1a-6b7e2c4d5a09",
  },
  {
    id: 9001,
    action: "assignment.created",
    entity_type: "UserAssignment",
    entity_id: "102",
    actor_kind: "USER",
    actor_id: "devuser",
    timestamp: "2026-10-21T10:05:00.000000Z",
    request_id: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
  },
];

/**
 * Effective permissions for one fixture user, as the mock computes them from
 * its assignment rows (the live adapter asks the backend instead).
 */
export function effectiveAccessFixtures(
  user: PlatformUser,
  assignments: UserAssignment[],
): EffectivePermission[] {
  return assignments
    .filter((assignment) => assignment.user_id === user.id)
    .map((assignment) => ({
      role: assignment.role,
      scope_type: assignment.scope_type,
      scope_id: assignment.scope_id,
      scope_label: assignment.scope_label,
      permissions: ROLE_PERMISSIONS[assignment.role],
    }));
}
