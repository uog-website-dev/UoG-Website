"""Strict DRF contracts for authorization administration."""
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.organizations.models import OrganizationUnit
from apps.sites.models import Site

from .catalog import SITE_MEMBERSHIP_ROLE_CODES, capability_for
from .models import AuthorizationAuditEvent, Permission, Role, UserRoleAssignment


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("id", "code", "name", "description", "module", "resource_type", "action", "risk", "delegable", "is_system", "is_active", "created_at", "updated_at")
        read_only_fields = fields


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ("id", "code", "name", "description", "is_system", "is_active", "permissions", "created_at", "updated_at")
        read_only_fields = ("id", "is_system", "permissions", "created_at", "updated_at")

    @extend_schema_field({"type": "array", "items": {"type": "string"}})
    def get_permissions(self, role) -> list[str]:
        return list(role.permission_links.filter(
            permission__is_active=True, permission__is_system=True,
        ).values_list("permission__code", flat=True))

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:
            fields["code"].read_only = True
        return fields

    def validate(self, attrs):
        if self.instance and self.instance.is_system:
            forbidden = set(self.initial_data) - {"name", "description"}
            if forbidden:
                raise serializers.ValidationError({key: ["System role templates are controlled by code and migrations."] for key in sorted(forbidden)})
        elif set(self.initial_data) - {"code", "name", "description", "is_active"}:
            raise serializers.ValidationError("Unknown or read-only role field.")
        if not self.instance and attrs.get("code") in {
            "platform-administrator", "organization-administrator", "site-administrator",
            "editor", "reviewer", "publisher", "viewer",
        }:
            raise serializers.ValidationError({"code": ["Standard role codes are reserved."]})
        return attrs


class PermissionSetSerializer(serializers.Serializer):
    permissions = serializers.ListField(child=serializers.CharField(max_length=120), allow_empty=True)

    def validate_permissions(self, values):
        codes = set(values)
        if len(codes) != len(values):
            raise serializers.ValidationError("Duplicate permission codes are not allowed.")
        if not codes <= set(Permission.objects.filter(is_active=True, is_system=True).values_list("code", flat=True)):
            raise serializers.ValidationError("One or more permissions are unknown or inactive.")
        if any(capability_for(code) is None for code in codes):
            raise serializers.ValidationError("Unregistered permissions cannot be assigned.")
        return sorted(codes)


class AssignmentCreateSerializer(serializers.Serializer):
    user = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.filter(is_active=True))
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.filter(is_active=True))
    scope = serializers.ChoiceField(choices=UserRoleAssignment.Scope.choices)
    organization = serializers.PrimaryKeyRelatedField(queryset=OrganizationUnit.objects.all(), required=False, allow_null=True)
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.all(), required=False, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        allowed = {"user", "role", "scope", "organization", "site", "expires_at"}
        if set(self.initial_data) - allowed:
            raise serializers.ValidationError("Unknown assignment field.")
        scope = attrs["scope"]
        organization = attrs.get("organization")
        site = attrs.get("site")
        role = attrs["role"]
        if role.code == "platform-administrator" and scope != UserRoleAssignment.Scope.PLATFORM:
            raise serializers.ValidationError({"scope": ["Platform Administrator assignments must be platform-wide."]})
        if role.code == "organization-administrator" and scope != UserRoleAssignment.Scope.ORGANIZATION:
            raise serializers.ValidationError({"scope": ["Organization Administrator assignments must be organization-scoped."]})
        if role.code == "site-administrator" and scope != UserRoleAssignment.Scope.SITE:
            raise serializers.ValidationError({"scope": ["Site Administrator assignments must be site-scoped."]})
        if scope == UserRoleAssignment.Scope.PLATFORM:
            if organization or site:
                raise serializers.ValidationError("Platform assignments cannot include an organization or site.")
        elif scope == UserRoleAssignment.Scope.ORGANIZATION:
            if organization is None or site is not None:
                raise serializers.ValidationError("Organization assignments require an organization and no site.")
            if organization.status != OrganizationUnit.Status.ACTIVE:
                raise serializers.ValidationError({"organization": ["Assignments require an active organization."]})
        elif scope == UserRoleAssignment.Scope.SITE:
            if organization is None or site is None or site.organization_unit_id != organization.pk:
                raise serializers.ValidationError({"site": ["The selected site must belong to the selected organization."]})
            if organization.status != OrganizationUnit.Status.ACTIVE or site.status == Site.Status.ARCHIVED:
                raise serializers.ValidationError({"site": ["Assignments require an active organization and a non-archived site."]})
            if role.code not in SITE_MEMBERSHIP_ROLE_CODES:
                raise serializers.ValidationError({
                    "role": [
                        "Only Site Administrator, Editor, Publisher, Reviewer, or Viewer can be assigned to a Site."
                    ]
                })
        return attrs


class AssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_first_name = serializers.CharField(source="user.first_name", read_only=True)
    user_last_name = serializers.CharField(source="user.last_name", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)

    class Meta:
        model = UserRoleAssignment
        fields = ("id", "user", "user_name", "user_email", "user_first_name", "user_last_name", "role", "role_name", "scope", "organization", "site", "assigned_by", "assigned_at", "expires_at", "revoked_at", "revoked_by")
        read_only_fields = fields


class SiteDirectoryUserSerializer(serializers.Serializer):
    user = serializers.IntegerField()
    user_name = serializers.CharField()
    user_email = serializers.EmailField(allow_blank=True)
    user_first_name = serializers.CharField(allow_blank=True)
    user_last_name = serializers.CharField(allow_blank=True)
    profile_picture = serializers.CharField(allow_blank=True)
    assignments = AssignmentSerializer(many=True)


class SiteUserCreateSerializer(serializers.Serializer):
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.exclude(status=Site.Status.ARCHIVED))
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.filter(is_active=True,code__in=SITE_MEMBERSHIP_ROLE_CODES))
    username = serializers.RegexField(r"^[a-zA-Z0-9][a-zA-Z0-9._@+-]{2,149}$",max_length=150)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True,trim_whitespace=False,max_length=128)
    password_confirmation = serializers.CharField(write_only=True,trim_whitespace=False,max_length=128)
    profile_picture = serializers.CharField(required=False,allow_blank=True,max_length=2796204,write_only=True)

    def validate(self,attrs):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        from apps.accounts.site_provisioning import normalize_picture
        unknown = set(self.initial_data)-set(self.fields)
        if unknown:
            raise serializers.ValidationError({key:"Unknown field." for key in unknown})
        attrs["username"] = attrs["username"].lower()
        attrs["email"] = attrs["email"].lower()
        errors = {}
        user_model=get_user_model()
        from django.conf import settings
        if attrs["username"] == getattr(settings,"DEV_PLATFORM_ADMIN_USERNAME","").lower() or attrs["username"].startswith("service-account-"):
            errors["username"]="This username is reserved for platform identity management."
        if user_model.objects.filter(username__iexact=attrs["username"]).exists():
            errors["username"]="This username is already registered. Use Add existing user."
        if user_model.objects.filter(email__iexact=attrs["email"]).exists():
            errors["email"]="This email is already registered. Use Add existing user."
        if attrs["password"] != attrs.pop("password_confirmation"):
            errors["password_confirmation"]="Passwords do not match."
        try:
            validate_password(attrs["password"],user_model(username=attrs["username"],email=attrs["email"]))
        except DjangoValidationError as exc:
            errors["password"]=exc.messages
        if attrs["site"].organization_unit.status != OrganizationUnit.Status.ACTIVE:
            errors["site"]="Choose a Site with an active owning organization."
        if errors:
            raise serializers.ValidationError(errors)
        attrs["profile_picture"] = normalize_picture(attrs.get("profile_picture",""))
        return attrs


class SiteIdentitySearchSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    first_name = serializers.CharField(allow_blank=True)
    last_name = serializers.CharField(allow_blank=True)
    assigned_role_ids = serializers.ListField(child=serializers.IntegerField())


class SiteAssignableRoleSerializer(RoleSerializer):
    assignable = serializers.BooleanField()

    class Meta(RoleSerializer.Meta):
        fields = (*RoleSerializer.Meta.fields, "assignable")
        read_only_fields = fields


class EffectivePermissionSerializer(serializers.Serializer):
    user = serializers.IntegerField()
    organization = serializers.IntegerField(allow_null=True)
    site = serializers.IntegerField(allow_null=True)
    permissions = serializers.ListField(child=serializers.CharField())


class EffectiveScopeQuerySerializer(serializers.Serializer):
    """Query contract for one validated effective-permission scope."""

    scope = serializers.ChoiceField(choices=["PLATFORM", "ORGANIZATION", "SITE"])
    organization = serializers.IntegerField(required=False, min_value=1, max_value=9223372036854775807)
    site = serializers.IntegerField(required=False, min_value=1, max_value=9223372036854775807)

    def validate(self, attrs):
        scope = attrs["scope"]
        organization = attrs.get("organization")
        site = attrs.get("site")
        if scope == "PLATFORM" and (organization is not None or site is not None):
            raise serializers.ValidationError({"scope": ["Platform scope cannot include organization or site identifiers."]})
        if scope == "ORGANIZATION":
            if organization is None:
                raise serializers.ValidationError({"organization": ["Organization scope requires an organization identifier."]})
            if site is not None:
                raise serializers.ValidationError({"site": ["Organization scope cannot include a site identifier."]})
        if scope == "SITE" and site is None:
            raise serializers.ValidationError({"site": ["Site scope requires a site identifier."]})
        return attrs


class AuthorizationAuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuthorizationAuditEvent
        fields = ("id", "actor", "action", "outcome", "permission_code", "subject_user_id", "role_code", "scope", "organization_id", "site_id", "resource_type", "resource_id", "request_id", "details", "created_at")
        read_only_fields = fields
