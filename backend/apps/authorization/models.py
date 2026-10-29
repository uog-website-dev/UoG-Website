"""Database-backed application roles and scoped user-role assignments.

Permission definitions are a reviewed capability catalog. Rows can be
activated/deactivated administratively, but only codes registered in
application code are ever evaluated as executable permissions.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .catalog import capability_for


PERMISSION_CODE_VALIDATOR = RegexValidator(
    r"\A[a-z][a-z0-9]*(?:[._][a-z][a-z0-9_]*)+\Z",
    "Use a stable namespaced code such as content.pages.view.",
)
ROLE_CODE_VALIDATOR = RegexValidator(
    r"\A[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*\Z",
    "Use a lowercase stable role code.",
)


class Permission(models.Model):
    class Risk(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    code = models.CharField(max_length=120, unique=True, validators=[PERMISSION_CODE_VALIDATOR])
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    module = models.CharField(max_length=80)
    resource_type = models.CharField(max_length=80)
    action = models.CharField(max_length=80)
    risk = models.CharField(max_length=8, choices=Risk.choices, default=Risk.LOW)
    delegable = models.BooleanField(default=True)
    is_system = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("module", "resource_type", "action", "code")
        indexes = [models.Index(fields=["module", "resource_type", "action"], name="auth_perm_module_res_act")]
        constraints = [
            models.CheckConstraint(condition=~Q(name=""), name="auth_perm_name_required"),
            models.CheckConstraint(condition=Q(risk__in=["LOW", "MEDIUM", "HIGH", "CRITICAL"]), name="auth_perm_valid_risk"),
        ]

    def clean(self):
        super().clean()
        PERMISSION_CODE_VALIDATOR(self.code)
        if not capability_for(self.code):
            raise ValidationError({"code": "Only reviewed, registered application capabilities can be stored."})
        if self.is_system and type(self).objects.filter(pk=self.pk).exclude(code=self.code).exists():
            raise ValidationError({"code": "System permission codes are immutable."})

    def __str__(self):
        return self.code


class Role(models.Model):
    code = models.CharField(max_length=80, unique=True, validators=[ROLE_CODE_VALIDATOR])
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("is_system", "name", "code")
        indexes = [models.Index(fields=["is_active", "code"], name="auth_role_active_code")]
        constraints = [models.CheckConstraint(condition=~Q(name=""), name="auth_role_name_required")]

    def clean(self):
        super().clean()
        ROLE_CODE_VALIDATOR(self.code)
        if self._state.adding and self.code in {
            "platform-administrator", "organization-administrator", "site-administrator",
            "editor", "reviewer", "publisher", "viewer",
        }:
            raise ValidationError({"code": "Standard role codes are reserved."})
        if self.is_system and type(self).objects.filter(pk=self.pk).exclude(code=self.code).exists():
            raise ValidationError({"code": "System role codes are immutable."})

    def delete(self, *args, **kwargs):
        if self.is_system:
            raise ValidationError("System roles cannot be deleted.")
        return super().delete(*args, **kwargs)

    def __str__(self):
        return self.name


class RolePermission(models.Model):
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="permission_links")
    permission = models.ForeignKey(Permission, on_delete=models.PROTECT, related_name="role_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("permission__code",)
        constraints = [models.UniqueConstraint(fields=["role", "permission"], name="auth_role_permission_uniq")]
        indexes = [models.Index(fields=["permission", "role"], name="auth_roleperm_lookup")]


class UserRoleAssignment(models.Model):
    class Scope(models.TextChoices):
        PLATFORM = "PLATFORM", "Platform"
        ORGANIZATION = "ORGANIZATION", "Organization"
        SITE = "SITE", "Site"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="role_assignments")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="user_assignments")
    scope = models.CharField(max_length=12, choices=Scope.choices)
    organization = models.ForeignKey(
        "organizations.OrganizationUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="authorization_assignments",
    )
    site = models.ForeignKey(
        "sites.Site", null=True, blank=True,
        on_delete=models.PROTECT, related_name="authorization_assignments",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.PROTECT, related_name="role_assignments_made",
    )
    assigned_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.PROTECT, related_name="role_assignments_revoked",
    )

    class Meta:
        ordering = ("user_id", "role__code", "scope", "organization_id", "site_id")
        indexes = [
            models.Index(fields=["user", "revoked_at", "expires_at"], name="auth_assign_user_live"),
            models.Index(fields=["role", "scope", "organization", "site"], name="auth_assign_scope_role"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(Q(scope="PLATFORM", organization__isnull=True, site__isnull=True)
                    | Q(scope="ORGANIZATION", organization__isnull=False, site__isnull=True)
                    | Q(scope="SITE", organization__isnull=False, site__isnull=False)),
                name="auth_assignment_valid_scope",
            ),
            models.UniqueConstraint(
                fields=["user", "role"],
                condition=Q(revoked_at__isnull=True, scope="PLATFORM"),
                name="auth_assignment_platform_uniq",
            ),
            models.UniqueConstraint(
                fields=["user", "role", "organization"],
                condition=Q(revoked_at__isnull=True, scope="ORGANIZATION"),
                name="auth_assignment_org_uniq",
            ),
            models.UniqueConstraint(
                fields=["user", "role", "site"],
                condition=Q(revoked_at__isnull=True, scope="SITE"),
                name="auth_assignment_site_uniq",
            ),
        ]

    def clean(self):
        super().clean()
        if self.role_id and self.role.code == "platform-administrator" and self.scope != self.Scope.PLATFORM:
            raise ValidationError({"scope": "Platform Administrator assignments must be platform-wide."})
        if self.role_id and self.role.code == "organization-administrator" and self.scope != self.Scope.ORGANIZATION:
            raise ValidationError({"scope": "Organization Administrator assignments must be organization-scoped."})
        if self.role_id and self.role.code == "site-administrator" and self.scope != self.Scope.SITE:
            raise ValidationError({"scope": "Site Administrator assignments must be site-scoped."})
        if self.scope == self.Scope.PLATFORM:
            if self.organization_id is not None or self.site_id is not None:
                raise ValidationError("Platform assignments cannot name an organization or site.")
        elif self.scope == self.Scope.ORGANIZATION:
            if self.organization_id is None or self.site_id is not None:
                raise ValidationError("Organization assignments require exactly one organization scope.")
        elif self.scope == self.Scope.SITE:
            if self.organization_id is None or self.site_id is None:
                raise ValidationError("Site assignments require a site and its owning organization.")
            if self.site_id and self.organization_id and self.site.organization_unit_id != self.organization_id:
                raise ValidationError({"organization": "The organization must own the assigned site."})
        else:
            raise ValidationError({"scope": "Unknown assignment scope."})
        if self._state.adding and self.expires_at and self.assigned_at and self.expires_at <= self.assigned_at:
            raise ValidationError({"expires_at": "An expiry must be later than assignment time."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user_id}:{self.role.code}:{self.scope}"


class AuthorizationAuditEvent(models.Model):
    """Append-only record of authorization decisions and administrative changes."""
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="authorization_events")
    action = models.CharField(max_length=80)
    outcome = models.CharField(max_length=12, choices=[("ALLOW", "Allow"), ("DENY", "Deny"), ("CHANGE", "Change")])
    permission_code = models.CharField(max_length=120, blank=True)
    subject_user_id = models.CharField(max_length=64, blank=True)
    role_code = models.CharField(max_length=80, blank=True)
    scope = models.CharField(max_length=12, blank=True)
    organization_id = models.CharField(max_length=64, blank=True)
    site_id = models.CharField(max_length=64, blank=True)
    resource_type = models.CharField(max_length=80, blank=True)
    resource_id = models.CharField(max_length=120, blank=True)
    request_id = models.UUIDField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["created_at"], name="auth_event_time"),
            models.Index(fields=["actor", "created_at"], name="auth_event_actor_time"),
            models.Index(fields=["subject_user_id", "created_at"], name="auth_event_user_time"),
            models.Index(fields=["permission_code", "outcome", "created_at"], name="auth_event_perm_outcome"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(outcome__in=["ALLOW", "DENY", "CHANGE"]), name="auth_event_valid_outcome"),
            models.CheckConstraint(condition=~Q(action=""), name="auth_event_action_required"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Authorization audit events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Authorization audit events are append-only.")
