from django.contrib import admin

from ..models import SiteDomain


@admin.register(SiteDomain)
class SiteDomainAdmin(admin.ModelAdmin):
    list_display = ("hostname", "site", "is_primary", "redirect_to_primary", "status")
    list_filter = ("status", "is_primary", "redirect_to_primary")
    search_fields = ("hostname", "site__code", "site__name")
    list_select_related = ("site",)
    autocomplete_fields = ("site",)
    readonly_fields = ("created_at", "updated_at")

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("hostname",) if obj is not None else ())

    def has_delete_permission(self, request, obj=None):
        return False
