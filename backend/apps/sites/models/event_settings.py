"""Site-owned Event Management configuration."""
from django.conf import settings
from django.db import models


class SiteEventSettings(models.Model):
    """One typed Events configuration per Site.

    Categories live in the shared taxonomy with kind=EVENTS. Aggregation
    eligibility is a read-side policy flag only; it never grants write access
    to another Site's Event records.
    """

    site = models.OneToOneField(
        "sites.Site", on_delete=models.CASCADE, related_name="event_settings",
        primary_key=True,
    )
    timezone = models.CharField(max_length=64, default="Africa/Addis_Ababa")
    public_list_path = models.CharField(max_length=2048, default="/events")
    registration_required_by_default = models.BooleanField(default=False)
    registration_default_capacity = models.PositiveIntegerField(null=True, blank=True)
    public_aggregation_eligible = models.BooleanField(
        default=False,
        help_text="When true, University Main may list this Site's published Events. Never grants cross-Site write access.",
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
        from apps.sites.events import validate_event_settings
        validate_event_settings({field: getattr(self, field) for field in EVENT_SETTINGS_FIELDS})

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        from django.core.exceptions import ValidationError
        with hierarchy_write(), database_audit_context():
            if not self._state.adding and getattr(self, "_original_site_id", self.site_id) != self.site_id:
                raise ValidationError({"site": "Event settings ownership cannot be reassigned."})
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])


EVENT_SETTINGS_FIELDS = (
    "timezone",
    "public_list_path",
    "registration_required_by_default",
    "registration_default_capacity",
    "public_aggregation_eligible",
)
