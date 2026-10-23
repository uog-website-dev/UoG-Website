from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "action", "entity_type", "entity_id", "actor_kind", "actor_id", "request_id")
    list_filter = ("action", "actor_kind", "entity_type")
    search_fields = ("entity_id", "actor_id", "request_id")
    readonly_fields = tuple(field.name for field in AuditEvent._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
