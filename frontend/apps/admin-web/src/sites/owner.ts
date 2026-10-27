/**
 * Owner-organization context for the site screens.
 *
 * A Site and its owner are deliberately distinct things: the console shows
 * the owning unit's code, name and *actual* institutional type rather than
 * assuming anything about it — a child site may belong to a college, an
 * institute or a department, and the data model allows an organization to
 * own several sites (there is no owner uniqueness rule).
 *
 * The topology the platform actively supports is the institutional root
 * plus its direct children, so each site is classified as:
 *
 *   - "root"    — owned by the root unit itself (a main site must be);
 *   - "child"   — owned by a unit that has a parent, with the root of its
 *                 chain resolved for display;
 *   - "unknown" — the hierarchy read did not include the owner (it can fail,
 *                 or be capped at 1000 nodes), in which case nothing is
 *                 invented: the site falls back to "Unit #id" and, if the
 *                 server has designated it main, the root relation it is
 *                 guaranteed to hold.
 *
 * Nothing here authorizes or restricts a write — it only labels what the
 * API returned.
 */
import type { Organization, Site } from "@uog/types";

import { organizationTypeLabel } from "@/organizations/validation";

export type SiteRelation = "root" | "child" | "unknown";

export interface OwnerInfo {
  unitId: number;
  /** Organization machine code, or null when the hierarchy read missed it. */
  code: string | null;
  name: string | null;
  /** Human institutional type (College, Department, …), never guessed. */
  typeLabel: string | null;
  relation: SiteRelation;
  /** The institutional root this owner sits under (the owner itself if root). */
  rootName: string | null;
  /** Owner lifecycle state as reported by the hierarchy read. */
  ownerStatus: Organization["status"] | null;
}

/**
 * Walk the parent chain to the root unit; cycle-safe and depth-capped.
 * Returns null when the chain leaves the known set before reaching a real
 * root — the last known unit is *not* presented as the root.
 */
function rootOf(
  start: Organization,
  byId: ReadonlyMap<number, Organization>,
): Organization | null {
  let current = start;
  for (let step = 0; step < 100; step += 1) {
    if (current.parent === null) return current;
    const parent = byId.get(current.parent);
    if (!parent) return null;
    current = parent;
  }
  return null;
}

/**
 * Resolve the owner context for one site against the flat hierarchy read
 * (`GET /api/v1/organizations/tree/`).
 */
export function ownerInfoFor(
  site: Site,
  units: readonly Organization[],
): OwnerInfo {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const owner = byId.get(site.organization_unit);

  if (!owner) {
    // The owner is simply not in the read set. A designated main site is
    // guaranteed (by the database rule) to sit on the UNIVERSITY root, so
    // that much is known; everything else stays unknown.
    return {
      unitId: site.organization_unit,
      code: null,
      name: null,
      typeLabel: null,
      relation: site.is_main ? "root" : "unknown",
      rootName: null,
      ownerStatus: null,
    };
  }

  const relation: SiteRelation = owner.parent === null ? "root" : "child";
  const root = rootOf(owner, byId);


  return {
    unitId: owner.id,
    code: owner.code,
    name: owner.name,
    typeLabel: organizationTypeLabel(owner.organization_type),
    relation,
    rootName: root?.name ?? null,
    ownerStatus: owner.status,
  };
}

/** Short display label for the owner, degrading to the raw id. */
export function ownerLabel(info: OwnerInfo): string {
  if (info.code && info.name) return `${info.code} — ${info.name}`;
  if (info.code) return info.code;
  return `Unit #${info.unitId}`;
}

/** Human relation label; "unknown" never claims a topology position. */
export function relationLabel(relation: SiteRelation): string {
  switch (relation) {
    case "root":
      return "Root site";
    case "child":
      return "Child site";
    case "unknown":
      return "Relation unknown";
  }
}
