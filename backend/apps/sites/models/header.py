"""Site-owned header presentation; navigation remains in published menus."""
from django.conf import settings
from django.db import models


class SiteHeader(models.Model):
    """One typed header configuration per Site.

    The header never stores menu trees: header and utility navigation keep
    living in the Site's published `header` and `secondary` menu locations so
    the existing menu draft/publish workflow stays the only source of truth.
    """

    site = models.OneToOneField(
        "sites.Site", on_delete=models.CASCADE, related_name="header_settings",
        primary_key=True,
    )
    brand_href = models.CharField(max_length=2048, default="/")
    search_enabled = models.BooleanField(default=True)
    sticky = models.BooleanField(default=False)
    cta_label = models.CharField(max_length=120, blank=True, default="")
    cta_url = models.CharField(max_length=2048, blank=True, default="")
    language_switcher = models.BooleanField(default=False)
    # Draft values above publish separately; visitors read this snapshot only.
    published_settings = models.JSONField(null=True, blank=True)
    previous_published_settings = models.JSONField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", editable=False,
    )
    version = models.PositiveIntegerField(default=1, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._original_site_id = instance.site_id
        return instance

    def clean(self):
        from apps.sites.header import validate_header
        validate_header({field: getattr(self, field) for field in HEADER_FIELDS})

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        from django.core.exceptions import ValidationError
        with hierarchy_write(), database_audit_context():
            if not self._state.adding and getattr(self, "_original_site_id", self.site_id) != self.site_id:
                raise ValidationError({"site": "Header ownership cannot be reassigned."})
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])


HEADER_FIELDS = (
    "brand_href", "search_enabled", "sticky", "cta_label", "cta_url",
    "language_switcher",
)
