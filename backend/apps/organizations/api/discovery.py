"""Validated query parameters and database-backed list discovery only."""
from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

from ..models import OrganizationType, OrganizationUnit

ORDERING_FIELDS = ("code", "name", "created_at", "updated_at")


class OrganizationDiscoverySerializer(serializers.Serializer):
    search = serializers.CharField(required=False, max_length=255, allow_blank=True)
    name = serializers.CharField(required=False, max_length=255)
    code = serializers.RegexField(r"\A[A-Za-z][A-Za-z0-9_-]{0,63}\Z", required=False, max_length=64)
    type = serializers.RegexField(r"\A[A-Z][A-Z0-9_]{0,63}\Z", required=False, max_length=64)
    parent = serializers.CharField(required=False, max_length=19)
    status = serializers.ChoiceField(choices=OrganizationUnit.Status.choices, required=False)
    ordering = serializers.CharField(required=False, max_length=100)

    def to_internal_value(self, data):
        errors = {key: ["Unknown query parameter."] for key in set(data) - set(self.fields) - {"page"}}
        if hasattr(data, "getlist"):
            errors.update({key: ["Supply this query parameter only once."] for key in data if len(data.getlist(key)) != 1})
        if errors:
            raise serializers.ValidationError(errors)
        # QueryDict is classified as HTML form input by DRF, which otherwise
        # silently skips explicit empty optional fields. Preserve query presence
        # so blank filters are validated rather than accidentally broadened.
        return super().to_internal_value(dict(data.items()))

    def validate_code(self, value):
        return value.upper()

    def validate_type(self, value):
        if not OrganizationType.objects.filter(code=value).exists():
            raise serializers.ValidationError("Unknown organization type code.")
        return value

    def validate_parent(self, value):
        if value == "null":
            return None
        if not value.isascii() or not value.isdecimal() or not 1 <= int(value) <= 9223372036854775807:
            raise serializers.ValidationError("Use a positive bigint organization ID or 'null' for roots.")
        return int(value)

    def validate_ordering(self, value):
        fields = [field.strip() for field in value.split(",")]
        if (
            len(fields) > len(ORDERING_FIELDS)
            or any(field.removeprefix("-") not in ORDERING_FIELDS for field in fields)
            or len({field.removeprefix("-") for field in fields}) != len(fields)
        ):
            raise serializers.ValidationError("Use distinct comma-separated code, name, created_at or updated_at fields; prefix '-' for descending.")
        if not any(field.removeprefix("-") == "code" for field in fields):
            fields.append("code")  # Unique, immutable tie-breaker across pages.
        return fields


DISCOVERY_PARAMETERS = [
    OpenApiParameter("search", str, description="Trimmed, case-insensitive literal substring of name OR code; blank means no search. Maximum 255 characters."),
    OpenApiParameter("name", str, description="Case-insensitive literal name substring. Maximum 255 characters."),
    OpenApiParameter("code", str, description="Exact code, trimmed and normalized to uppercase. Maximum 64 characters."),
    OpenApiParameter("type", str, description="Exact existing managed organization type code, for example COLLEGE. Case-sensitive; unknown codes return 400."),
    OpenApiParameter("parent", str, description="Direct parent bigint ID, or literal 'null' for roots. Valid but absent/invisible parent IDs yield an empty list."),
    OpenApiParameter("status", str, enum=OrganizationUnit.Status.values, description="Exact lifecycle status. Omitted: all states."),
    OpenApiParameter("ordering", str, description="Comma-separated code, name, created_at, updated_at; '-' for descending. Default code. Unique code ascending is appended as a tie-breaker if absent. Unknown/duplicate fields return 400."),
]
