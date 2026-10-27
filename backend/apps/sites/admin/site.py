from django.contrib import admin
from django.db.models import Q

from ..models import Site, SiteTemplate


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "organization_unit", "template", "status", "default_language", "is_main")
    list_filter = ("status", "is_main", "default_language")
    search_fields = ("code", "name", "short_name")
    autocomplete_fields = ("organization_unit", "template")
    list_select_related = ("organization_unit", "template")
    readonly_fields = ("created_at", "updated_at")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "template":
            current = None
            object_id = getattr(request.resolver_match, "kwargs", {}).get("object_id")
            if object_id:
                current = Site.objects.filter(pk=object_id).values_list("template_id", flat=True).first()
            allowed = Q(status=SiteTemplate.Status.ACTIVE)
            if current:
                allowed |= Q(pk=current)
            kwargs["queryset"] = SiteTemplate.objects.filter(allowed)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("code",) if obj is not None else ())

    def has_delete_permission(self, request, obj=None):
        return False
