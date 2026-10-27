"""Reject unknown list parameters and apply the documented filters."""
from django.core.exceptions import ValidationError
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

from ..hostnames import normalize_hostname
from ..models import Module, Site, SiteDomain, SiteTemplate


class QuerySerializer(serializers.Serializer):
    ordering = serializers.CharField(required=False, max_length=100)

    def to_internal_value(self, data):
        errors = {key: ["Unknown query parameter."] for key in set(data) - set(self.fields) - {"page"}}
        if hasattr(data, "getlist"):
            errors.update({key: ["Supply this query parameter only once."] for key in data if len(data.getlist(key)) != 1})
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(dict(data.items()))

    def validate_ordering(self, value):
        allowed = self.context["ordering_fields"]
        fields = [field.strip() for field in value.split(",")]
        names = [field.removeprefix("-") for field in fields]
        if len(fields) > len(allowed) or any(name not in allowed for name in names) or len(set(names)) != len(names):
            raise serializers.ValidationError(f"Use distinct comma-separated {', '.join(allowed)} fields; prefix '-' for descending.")
        if allowed[0] not in names:
            fields.append(allowed[0])
        return fields


class SiteQuerySerializer(QuerySerializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    code = serializers.CharField(required=False, max_length=64)
    status = serializers.ChoiceField(choices=Site.Status.choices, required=False)
    organization_unit = serializers.IntegerField(required=False, min_value=1)

    def validate_code(self, value):
        return value.strip().upper()


class DomainQuerySerializer(QuerySerializer):
    hostname = serializers.CharField(required=False, max_length=253)
    status = serializers.ChoiceField(choices=SiteDomain.Status.choices, required=False)
    is_primary = serializers.BooleanField(required=False)

    def validate_hostname(self, value):
        try:
            return normalize_hostname(value)
        except ValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc


class TemplateQuerySerializer(QuerySerializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    code = serializers.CharField(required=False, max_length=64)
    status = serializers.ChoiceField(choices=SiteTemplate.Status.choices, required=False)

    def validate_code(self, value):
        return value.strip().upper()


class ModuleQuerySerializer(QuerySerializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    code = serializers.CharField(required=False, max_length=64)
    status = serializers.ChoiceField(choices=Module.Status.choices, required=False)
    is_enabled = serializers.BooleanField(required=False)

    def validate_code(self, value):
        return value.strip().upper()


class SiteModuleQuerySerializer(QuerySerializer):
    module = serializers.IntegerField(required=False, min_value=1)
    is_enabled = serializers.BooleanField(required=False)


def apply_filters(queryset, data, specs, default):
    search = str(data.get("search", "")).strip()
    if search:
        queryset = queryset.filter(Q(name__icontains=search) | Q(code__icontains=search))
    for field, lookup in specs:
        if field in data:
            queryset = queryset.filter(**{lookup: data[field]})
    return queryset.order_by(*(data.get("ordering") or [default]))


LIST_PARAMETERS = [
    OpenApiParameter("search", str, description="Case-insensitive name or code substring. Blank applies no search."),
    OpenApiParameter("code", str, description="Exact code, trimmed and uppercased."),
    OpenApiParameter("ordering", str, description="Comma-separated fields; prefix '-' for descending. The first default field is appended as a tie-breaker."),
    OpenApiParameter("page", int, description="Page number. Page size is 20."),
]
