"""Site-scoped content primitives shared by every content type.

Pages, Posts and future content records all own exactly one Site and share
one publishing contract, so publishing logic is never duplicated per type.
This module is a *primitive*: it defines the shared domain and its rules,
not a generic content API. See docs/architecture/cms-content-data-model.md
for the site-scoped uniqueness and index strategy.
"""
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, router
from django.db.models import Q, Value
from django.db.models.lookups import Exact
from django.utils import timezone


class ContentStatus(models.TextChoices):
    """Lifecycle shared by every content record. Archived is terminal."""

    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    ARCHIVED = "ARCHIVED", "Archived"


_TRANSITIONS = {
    ContentStatus.DRAFT: {ContentStatus.PUBLISHED, ContentStatus.ARCHIVED},
    ContentStatus.PUBLISHED: {ContentStatus.DRAFT, ContentStatus.ARCHIVED},
    ContentStatus.ARCHIVED: set(),
}

LANGUAGE_FORMAT = r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z"


class SiteContent(models.Model):
    """One record of site-owned content.

    Concrete so that migration, constraint and multi-site behaviour are real
    and testable today; later content types (Page, Post, …) subclass it via
    multi-table inheritance and inherit the columns, indexes and publishing
    rules instead of re-declaring them.
    """

    id = models.UUIDField(
        primary_key=True, default=uuid.uuid4, editable=False,
        help_text="Immutable identifier. UUIDs are assigned once and can never "
                  "be changed or re-sequenced, so ids are not enumerable across Sites.",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="content",
        help_text="Owning Site. Content cannot be moved between Sites.",
    )
    status = models.CharField(
        max_length=9, choices=ContentStatus.choices, default=ContentStatus.DRAFT,
        help_text="DRAFT, PUBLISHED or ARCHIVED. Archived is terminal.",
    )
    locale = models.CharField(
        max_length=35, blank=True, default="",
        validators=[RegexValidator(
            LANGUAGE_FORMAT,
            "Use a normalized language code such as en, am or en-us.",
        )],
        help_text="BCP-47-style language tag in the same format as the Site's "
                  "language codes. Empty means the Site's default language; an "
                  "explicit value must be enabled for the Site. Storage format "
                  "only — this does not claim a translation workflow.",
    )
    published_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the record was first published. Set on the first "
                  "publish and kept as history if the record is unpublished.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="Authoring platform user, cleared if the account is removed.",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="Last editing platform user, cleared if the account is removed.",
    )
    metadata = models.JSONField(
        default=dict, blank=True,
        help_text="Free-form JSON object for approved content metadata. Not a "
                  "settings document and never a place for secrets.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=["DRAFT", "PUBLISHED", "ARCHIVED"]),
                name="content_status",
            ),
            models.CheckConstraint(
                condition=Q(locale__regex=LANGUAGE_FORMAT),
                name="content_locale_format",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("metadata", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="content_metadata_object",
            ),
        ]
        indexes = [
            # Ownership-leading indexes: every content query is scoped by the
            # owning Site first (docs/architecture/cms-content-data-model.md).
            models.Index(fields=["site", "status"], name="cms_content_site_status_idx"),
            models.Index(fields=["site", "-updated_at"], name="cms_content_site_recent_idx"),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.pk}"

    def clean(self):
        super().clean()
        previous = None
        if not self._state.adding:
            using = self._state.db or router.db_for_write(type(self), instance=self)
            previous = (
                type(self).objects.using(using)
                .filter(pk=self.pk)
                .values("site_id", "status")
                .first()
            )
            if previous is None:
                raise ValidationError({"id": "Content identifiers are immutable."})
            if previous["site_id"] != self.site_id:
                raise ValidationError({"site": "Content cannot be moved between Sites."})
            if (
                previous["status"] != self.status
                and self.status not in _TRANSITIONS[previous["status"]]
            ):
                raise ValidationError({"status": "That content status change is not allowed."})

        if not isinstance(self.metadata, dict):
            raise ValidationError({"metadata": "Metadata must be a JSON object."})

        if self.site_id:
            enabled = self._enabled_languages()
            if not self.locale:
                # Absent locale inherits the Site's default language, which the
                # Site's own constraints guarantee to be enabled.
                self.locale = self.site.default_language
            elif enabled and self.locale not in enabled:
                raise ValidationError({
                    "locale": "This language is not enabled for the Site. "
                              "Enable it in the Site configuration first.",
                })

        if self.status == ContentStatus.PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()

    def _enabled_languages(self):
        configuration = (self.site.configuration or {}) if self.site_id else {}
        enabled = configuration.get("language", {}).get("enabled")
        if isinstance(enabled, list) and enabled:
            return [str(value) for value in enabled]
        return [self.site.default_language] if self.site_id else []

    def full_clean(self, *args, **kwargs):
        if isinstance(self.locale, str):
            self.locale = self.locale.strip().lower()
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        supplied_locale = self.locale
        supplied_published_at = self.published_at
        self.full_clean()
        if kwargs.get("update_fields"):
            fields = set(kwargs["update_fields"]) | {"updated_at"}
            if self.locale != supplied_locale:
                fields.add("locale")
            if self.published_at != supplied_published_at:
                fields.add("published_at")
            kwargs["update_fields"] = fields
        return super().save(*args, **kwargs)
