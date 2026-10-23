"""Explicit public fields; lifecycle and immutable fields are never mass assigned."""
from rest_framework import serializers

from ..models import OrganizationType, OrganizationUnit


class OrganizationSerializer(serializers.ModelSerializer):
    metadata = serializers.DictField(child=serializers.JSONField(allow_null=True), required=False)
    organization_type = serializers.SlugRelatedField(
        slug_field="code", queryset=OrganizationType.objects.all(),
        help_text="Stable type code, for example COLLEGE. Type changes follow root and lifecycle rules.",
    )

    class Meta:
        model = OrganizationUnit
        fields = (
            "id", "code", "name", "short_name", "organization_type", "parent",
            "description", "status", "metadata", "created_at", "updated_at",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at")
        validators = []  # Domain validation runs under the hierarchy write lock.
        extra_kwargs = {"code": {"validators": []}}

    def to_internal_value(self, data):
        if isinstance(data, dict):
            forbidden = set(data) - {
                name for name, field in self.fields.items() if not field.read_only
            }
            if self.instance is not None and "code" in data:
                forbidden.add("code")
            if forbidden:
                raise serializers.ValidationError({
                    key: ["Unknown, read-only, or immutable field."] for key in sorted(forbidden)
                })
        return super().to_internal_value(data)

    def validate_code(self, value):
        return value.strip().upper()

    def validate_metadata(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Metadata must be a JSON object.")
        return value


class OrganizationUpdateSerializer(OrganizationSerializer):
    class Meta(OrganizationSerializer.Meta):
        read_only_fields = (*OrganizationSerializer.Meta.read_only_fields, "code")


class OrganizationHierarchySerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=0, max_value=1000, read_only=True)
    results = OrganizationSerializer(many=True, read_only=True)


class LifecycleRequestSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or data:
            raise serializers.ValidationError({"non_field_errors": ["Send an empty JSON object."]})
        return {}
