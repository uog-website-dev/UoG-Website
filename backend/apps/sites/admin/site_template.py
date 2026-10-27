from django.contrib import admin

from ..models import SiteTemplate


@admin.register(SiteTemplate)
class SiteTemplateAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "status")
    list_filter = ("status",)
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at")

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("code",) if obj is not None else ())

    def has_delete_permission(self, request, obj=None):
        return False
