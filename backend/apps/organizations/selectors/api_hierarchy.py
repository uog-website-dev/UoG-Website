"""Bounded traversal through an explicitly authorized queryset only."""
from django.db import connections

from ..models import OrganizationUnit

MAX_HIERARCHY_NODES = 1000


class HierarchyTooLarge(Exception):
    pass


def get_hierarchy_nodes(visible_units, relation, *, unit_id=None):
    """Return a flat forest, never traversing or exposing hidden parent IDs.

    Keep the existing unrestricted domain selectors for integrity validation.
    API callers must supply their authorized queryset here. The first query
    retrieves at most limit+1 IDs without sorting the whole recursive result;
    hydration and boundary-parent checks use two batched queries, not one per
    node. All lifecycle states are retained to avoid hiding structural links.
    """
    visible_sql, parameters = visible_units.order_by().values("id", "parent_id").query.sql_with_params()
    parameters = list(parameters)
    if relation == "tree":
        seed = "SELECT v.id, v.parent_id, 0 FROM visible v WHERE v.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM visible p WHERE p.id = v.parent_id)"
    elif relation == "children":
        seed = "SELECT v.id, v.parent_id, 1 FROM visible v WHERE v.parent_id = %s"
        parameters.append(unit_id)
    elif relation in {"ancestors", "descendants", "subtree"}:
        seed = "SELECT v.id, v.parent_id, 0 FROM visible v WHERE v.id = %s"
        parameters.append(unit_id)
    else:
        raise ValueError("Unknown hierarchy relation.")

    if relation == "children":
        walk = seed
    else:
        join = "v.id = w.parent_id" if relation == "ancestors" else "v.parent_id = w.id"
        walk = f"{seed} UNION ALL SELECT v.id, v.parent_id, w.depth + 1 FROM visible v JOIN walk w ON {join}"
    exclude_self = "WHERE depth > 0" if relation in {"ancestors", "descendants"} else ""
    parameters.append(MAX_HIERARCHY_NODES + 1)
    with connections[visible_units.db].cursor() as cursor:
        cursor.execute(f"""
            WITH RECURSIVE visible AS ({visible_sql}),
            walk(id, parent_id, depth) AS ({walk})
            SELECT id, parent_id, depth FROM walk {exclude_self} LIMIT %s
        """, parameters)
        rows = cursor.fetchall()
    if len(rows) > MAX_HIERARCHY_NODES:
        raise HierarchyTooLarge()
    if not rows:
        return []

    depths = {row[0]: row[2] for row in rows}
    # Reapply authorization when hydrating, including any new policy filters.
    units = list(visible_units.filter(pk__in=depths).select_related("organization_type"))
    parent_ids = {unit.parent_id for unit in units if unit.parent_id is not None}
    visible_parents = set(visible_units.filter(pk__in=parent_ids).values_list("pk", flat=True)) if parent_ids else set()
    for unit in units:
        if unit.parent_id is not None and unit.parent_id not in visible_parents:
            # A visible boundary node is a root of this response's forest.
            # Do not reveal the identifier of an unauthorized parent.
            unit.parent_id = None
    units.sort(key=lambda unit: ((-depths[unit.pk] if relation == "ancestors" else depths[unit.pk]), unit.code))
    return units
