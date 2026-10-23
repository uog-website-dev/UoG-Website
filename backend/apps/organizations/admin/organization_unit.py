"""Institutional unit administration without Site-specific configuration."""
from django.contrib import admin

from ..models import OrganizationUnit


@admin.register(OrganizationUnit)
class OrganizationUnitAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "short_name", "organization_type", "parent", "status")
    list_filter = ("status", "organization_type")
    search_fields = ("code", "name", "short_name")
    autocomplete_fields = ("organization_type", "parent")
    list_select_related = ("organization_type", "parent")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("code",)

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("code",) if obj is not None else ())

    def has_delete_permission(self, request, obj=None):
        return False
