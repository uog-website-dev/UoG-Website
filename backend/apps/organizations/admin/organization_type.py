"""Manage classifications without permitting changes to their stable codes."""
from django.contrib import admin

from ..models import OrganizationType


@admin.register(OrganizationType)
class OrganizationTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name")
    search_fields = ("code", "name")
    ordering = ("code",)

    def get_readonly_fields(self, request, obj=None):
        return ("code",) if obj is not None else ()
