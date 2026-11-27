"""Site-owned Staff Directory configuration."""
from django.conf import settings
from django.db import models


class StaffDirectorySort(models.TextChoices):
    NAME_ASC = "NAME_ASC", "Name (A–Z)"
    NAME_DESC = "NAME_DESC", "Name (Z–A)"
    TITLE_ASC = "TITLE_ASC", "Title (A–Z)"
    DEPARTMENT_ASC = "DEPARTMENT_ASC", "Department (A–Z)"


class StaffDirectoryPresentation(models.TextChoices):
    LIST = "LIST", "List"
    CARDS = "CARDS", "Cards"


class SiteStaffDirectorySettings(models.Model):
    """One typed Staff Directory configuration per Site.

    College Sites always resolve membership from the mapped Organization and
    its descendants. University Main may additionally list profiles from Sites
    that opted into public aggregation eligibility. Aggregation never grants
    cross-Site write access.
    """

    site = models.OneToOneField(
        "sites.Site",
        on_delete=models.CASCADE,
        related_name="staff_directory_settings",
        primary_key=True,
    )
    page_size = models.PositiveIntegerField(default=20)
    default_sort = models.CharField(
        max_length=32,
        choices=StaffDirectorySort.choices,
        default=StaffDirectorySort.NAME_ASC,
    )
    public_list_path = models.CharField(max_length=2048, default="/staff")
    presentation = models.CharField(
        max_length=16,
        choices=StaffDirectoryPresentation.choices,
        default=StaffDirectoryPresentation.LIST,
    )
    public_aggregation_eligible = models.BooleanField(
        default=False,
        help_text=(
            "When true, University Main may include this Site's public directory "
            "entries. Never grants cross-Site write access."
        ),
    )
    version = models.PositiveIntegerField(default=1, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._original_site_id = instance.site_id
        return instance

    def clean(self):
        from apps.sites.staff import validate_staff_directory_settings

        validate_staff_directory_settings(
            {field: getattr(self, field) for field in STAFF_DIRECTORY_SETTINGS_FIELDS}
        )

    def save(self, *args, **kwargs):
        from apps.audit.context import database_audit_context
        from apps.organizations.hierarchy_lock import hierarchy_write
        from django.core.exceptions import ValidationError

        with hierarchy_write(), database_audit_context():
            if (
                not self._state.adding
                and getattr(self, "_original_site_id", self.site_id) != self.site_id
            ):
                raise ValidationError({"site": "Staff Directory settings ownership cannot be reassigned."})
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])


STAFF_DIRECTORY_SETTINGS_FIELDS = (
    "page_size",
    "default_sort",
    "public_list_path",
    "presentation",
    "public_aggregation_eligible",
)
