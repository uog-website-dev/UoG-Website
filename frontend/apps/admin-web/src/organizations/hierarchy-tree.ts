import type { Organization } from "@uog/types";

export interface OrganizationTreeRow {
  organization: Organization;
  level: number;
  hasChildren: boolean;
}

/**
 * Flatten the hierarchy iteratively so even very deep organization trees do
 * not depend on the JavaScript call-stack limit.
 */
export function buildOrganizationTreeRows(
  organizations: Organization[],
  expandedIds: ReadonlySet<number>,
  includeCollapsed = false,
): OrganizationTreeRow[] {
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  const children = new Map<number, Organization[]>();

  for (const organization of organizations) {
    if (organization.parent === null || !byId.has(organization.parent)) continue;
    const siblings = children.get(organization.parent) ?? [];
    siblings.push(organization);
    children.set(organization.parent, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.code.localeCompare(right.code));
  }

  const roots = organizations
    .filter(
      (organization) =>
        organization.parent === null || !byId.has(organization.parent),
    )
    .sort((left, right) => left.code.localeCompare(right.code));
  const rows: OrganizationTreeRow[] = [];
  const visited = new Set<number>();

  const visit = (organization: Organization, level: number) => {
    const stack = [{ organization, level }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current.organization.id)) continue;
      visited.add(current.organization.id);
      const descendants = children.get(current.organization.id) ?? [];
      rows.push({
        organization: current.organization,
        level: current.level,
        hasChildren: descendants.length > 0,
      });
      if (
        descendants.length > 0 &&
        (includeCollapsed || expandedIds.has(current.organization.id))
      ) {
        for (let index = descendants.length - 1; index >= 0; index -= 1) {
          stack.push({ organization: descendants[index], level: current.level + 1 });
        }
      }
    }
  };

  for (const root of roots) visit(root, 0);
  // A valid hierarchy has at least one root. For an entirely cyclic response,
  // surface every node once instead of making the UI disappear.
  if (roots.length === 0) {
    for (const organization of organizations) {
      if (!visited.has(organization.id)) visit(organization, 0);
    }
  }
  return rows;
}

export function getOrganizationAncestors(
  organizationId: number,
  organizations: Organization[],
): Organization[] {
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  const ancestors: Organization[] = [];
  const visited = new Set<number>([organizationId]);
  let parentId = byId.get(organizationId)?.parent ?? null;

  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parent;
  }

  return ancestors.reverse();
}

export function countOrganizationDescendants(
  organizationId: number,
  organizations: Organization[],
): number {
  const children = new Map<number, number[]>();
  for (const organization of organizations) {
    if (organization.parent === null) continue;
    const ids = children.get(organization.parent) ?? [];
    ids.push(organization.id);
    children.set(organization.parent, ids);
  }

  const descendants = new Set<number>();
  const stack = [...(children.get(organizationId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || descendants.has(id)) continue;
    descendants.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return descendants.size;
}
