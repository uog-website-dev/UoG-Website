"""Unfiltered structural queries; callers must apply authorization separately."""
from django.db import DEFAULT_DB_ALIAS

from ..models import OrganizationUnit


def get_parent(unit_id, *, using=DEFAULT_DB_ALIAS):
    return OrganizationUnit.objects.using(using).select_related("parent").get(pk=unit_id).parent


def get_children(unit_id, *, using=DEFAULT_DB_ALIAS):
    """Return a lazy code-ordered queryset (empty for a missing parent ID)."""
    return OrganizationUnit.objects.using(using).filter(parent_id=unit_id).order_by("code")


def get_ancestors(unit_id, *, include_self=False, using=DEFAULT_DB_ALIAS):
    """Return root-first ancestors in one query; missing unit IDs raise."""
    units = list(OrganizationUnit.objects.using(using).raw("""
        WITH RECURSIVE chain AS (
            SELECT u.*, 0 AS hierarchy_depth
            FROM organizations_organizationunit u WHERE u.id = %s
            UNION ALL
            SELECT p.*, c.hierarchy_depth + 1
            FROM organizations_organizationunit p JOIN chain c ON p.id = c.parent_id
        )
        SELECT * FROM chain ORDER BY hierarchy_depth DESC
    """, [unit_id]))
    if not units:
        raise OrganizationUnit.DoesNotExist("Organization unit does not exist.")
    return units if include_self else [u for u in units if u.hierarchy_depth > 0]


def get_descendants(unit_id, *, include_self=False, using=DEFAULT_DB_ALIAS):
    """Return breadth-first descendants, ordered by depth/code, in one query."""
    units = list(OrganizationUnit.objects.using(using).raw("""
        WITH RECURSIVE subtree AS (
            SELECT u.*, 0 AS hierarchy_depth
            FROM organizations_organizationunit u WHERE u.id = %s
            UNION ALL
            SELECT c.*, p.hierarchy_depth + 1
            FROM organizations_organizationunit c JOIN subtree p ON c.parent_id = p.id
        )
        SELECT * FROM subtree ORDER BY hierarchy_depth, code
    """, [unit_id]))
    if not units:
        raise OrganizationUnit.DoesNotExist("Organization unit does not exist.")
    return units if include_self else [u for u in units if u.hierarchy_depth > 0]


def get_subtree(unit_id, *, using=DEFAULT_DB_ALIAS):
    return get_descendants(unit_id, include_self=True, using=using)


def get_root(unit_id, *, using=DEFAULT_DB_ALIAS):
    return get_ancestors(unit_id, include_self=True, using=using)[0]
