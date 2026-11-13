/** Roles a Site may grant through its own Users screen. */
export const SITE_MEMBERSHIP_ROLE_CODES = [
  "site-administrator",
  "editor",
  "publisher",
  "reviewer",
  "viewer",
] as const;

export function isSiteMembershipRole(code: string): boolean {
  return (SITE_MEMBERSHIP_ROLE_CODES as readonly string[]).includes(code);
}

