"""Django admin controls for authorization records."""
from django.contrib import admin

from .models import AuthorizationAuditEvent, Permission, Role, RolePermission, UserRoleAssignment


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "module", "risk", "is_system", "is_active")
    list_filter = ("module", "risk", "is_system", "is_active")
    search_fields = ("code", "name", "description")
    readonly_fields = tuple(field.name for field in Permission._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class RolePermissionInline(admin.TabularInline):
    model = RolePermission
    extra = 0
    autocomplete_fields = ("permission",)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_system", "is_active", "updated_at")
    list_filter = ("is_system", "is_active")
    search_fields = ("code", "name", "description")
    readonly_fields = ("code", "is_system", "created_at", "updated_at")
    inlines = (RolePermissionInline,)

    def has_delete_permission(self, request, obj=None):
        return bool(obj is not None and not obj.is_system) and super().has_delete_permission(request, obj)

    def has_change_permission(self, request, obj=None):
        if obj is not None and obj.is_system:
            return False
        return super().has_change_permission(request, obj)

    def get_inlines(self, request, obj):
        return () if obj is not None and obj.is_system else super().get_inlines(request, obj)


@admin.register(UserRoleAssignment)
class UserRoleAssignmentAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "scope", "organization", "site", "assigned_at", "expires_at", "revoked_at")
    list_filter = ("scope", "role", "revoked_at")
    search_fields = ("user__username", "user__email", "role__code")
    readonly_fields = ("assigned_by", "assigned_at", "revoked_by", "revoked_at")
    autocomplete_fields = ("user", "role", "organization", "site")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuthorizationAuditEvent)
class AuthorizationAuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "outcome", "permission_code", "actor", "subject_user_id")
    list_filter = ("outcome", "action", "scope")
    search_fields = ("permission_code", "subject_user_id", "role_code", "resource_id")
    readonly_fields = tuple(field.name for field in AuthorizationAuditEvent._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
