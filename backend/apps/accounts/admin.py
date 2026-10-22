"""Django admin registration for the accounts app."""
from django.contrib import admin

from .models import OIDCIdentity


@admin.register(OIDCIdentity)
class OIDCIdentityAdmin(admin.ModelAdmin):
    list_display = ("user", "issuer", "subject", "created_at", "last_synced_at")
    search_fields = ("user__username", "user__email", "subject")
    readonly_fields = ("issuer", "subject", "created_at", "last_synced_at")
    list_select_related = ("user",)
