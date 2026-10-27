"""Explicit Site administration fields. Status changes use lifecycle actions."""
from rest_framework import serializers

from ..models import Module, Site, SiteDomain, SiteModule, SiteTemplate


class StrictFields:
    immutable_on_update = ()

    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            if self.instance is not None:
                writable -= set(self.immutable_on_update)
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({key: ["Unknown, read-only, or immutable field."] for key in sorted(forbidden)})
        return super().to_internal_value(data)


class SiteSerializer(StrictFields, serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = (
            "id", "code", "name", "short_name", "organization_unit", "default_language",
            "status", "is_main", "template", "configuration", "created_at", "updated_at",
        )
        read_only_fields = ("id", "status", "configuration", "created_at", "updated_at")
        extra_kwargs = {"code": {"validators": []}, "template": {"allow_null": True, "required": False}}

    def validate_code(self, value):
        return value.strip().upper()

    def create(self, validated_data):
        from ..services.templates import provision_site
        return provision_site(
            organization_unit=validated_data["organization_unit"],
            code=validated_data["code"],
            name=validated_data["name"],
            short_name=validated_data.get("short_name", ""),
            default_language=validated_data.get("default_language", "en-us"),
            template=validated_data.get("template"),
            configuration=validated_data.get("configuration_changes"),
            is_main=validated_data.get("is_main", False),
        )


class SiteCreateSerializer(SiteSerializer):
    configuration = serializers.JSONField(required=False, write_only=True)

    def validate(self, attrs):
        attrs["configuration_changes"] = attrs.pop("configuration", None)
        return attrs


class SiteUpdateSerializer(SiteSerializer):
    immutable_on_update = ("code",)

    class Meta(SiteSerializer.Meta):
        read_only_fields = (*SiteSerializer.Meta.read_only_fields, "code")


class SiteDomainSerializer(StrictFields, serializers.ModelSerializer):
    class Meta:
        model = SiteDomain
        fields = ("id", "site", "hostname", "is_primary", "redirect_to_primary", "status", "created_at", "updated_at")
        read_only_fields = ("id", "site", "is_primary", "created_at", "updated_at")
        extra_kwargs = {"hostname": {"validators": []}}


class DomainDeactivateSerializer(StrictFields, serializers.Serializer):
    replacement = serializers.IntegerField(required=False, min_value=1)


class SiteDomainUpdateSerializer(SiteDomainSerializer):
    immutable_on_update = ("hostname",)

    class Meta(SiteDomainSerializer.Meta):
        read_only_fields = (*SiteDomainSerializer.Meta.read_only_fields, "hostname")


class SiteTemplateSerializer(StrictFields, serializers.ModelSerializer):
    class Meta:
        model = SiteTemplate
        fields = ("id", "code", "name", "description", "status", "default_configuration", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")
        extra_kwargs = {"code": {"validators": []}}

    def validate_code(self, value):
        return value.strip().upper()


class SiteTemplateUpdateSerializer(SiteTemplateSerializer):
    immutable_on_update = ("code",)

    class Meta(SiteTemplateSerializer.Meta):
        read_only_fields = (*SiteTemplateSerializer.Meta.read_only_fields, "code")


class ModuleSerializer(StrictFields, serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ("id", "code", "name", "description", "status", "is_enabled", "configuration_schema", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")
        extra_kwargs = {"code": {"validators": []}}

    def validate_code(self, value):
        return value.strip().upper()


class ModuleUpdateSerializer(ModuleSerializer):
    immutable_on_update = ("code",)

    class Meta(ModuleSerializer.Meta):
        read_only_fields = (*ModuleSerializer.Meta.read_only_fields, "code")


class SiteModuleSerializer(StrictFields, serializers.ModelSerializer):
    class Meta:
        model = SiteModule
        fields = ("id", "site", "module", "is_enabled", "configuration", "created_at", "updated_at")
        read_only_fields = ("id", "site", "is_enabled", "created_at", "updated_at")


class EmptyObjectSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or data:
            raise serializers.ValidationError({"non_field_errors": ["Send an empty JSON object."]})
        return {}
