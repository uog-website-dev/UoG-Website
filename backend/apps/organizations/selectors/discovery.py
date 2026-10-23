"""Database-backed discovery that only narrows an authorized queryset."""
from django.db.models import Q


def discover_organizations(queryset, parameters):
    search = parameters.get("search")
    if search:
        queryset = queryset.filter(Q(name__icontains=search) | Q(code__icontains=search))
    if "name" in parameters:
        queryset = queryset.filter(name__icontains=parameters["name"])
    for parameter, lookup in [("code", "code"), ("type", "organization_type__code"), ("status", "status"), ("parent", "parent_id")]:
        if parameter in parameters:
            queryset = queryset.filter(**{lookup: parameters[parameter]})
    return queryset.order_by(*parameters.get("ordering", ["code"]))
