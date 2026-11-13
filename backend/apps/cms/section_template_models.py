"""Site-owned visual section templates for the Visual Builder.

Templates store one validated layout section (including nested widgets and
repeater order). Insertions deep-clone with fresh node IDs and revalidate
media against the target Site. Retiring or revising a template never rewrites
Pages that already received a clone.
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, router
from django.utils import timezone

from apps.organizations.hierarchy_lock import hierarchy_write

from .layout_contract import validate_layout, validate_layout_media

CURRENT_LAYOUT_SCHEMA_VERSION = 1


class SectionTemplateStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    RETIRED = "RETIRED", "Retired"


class SectionTemplateQuerySet(models.QuerySet):
    def update(self, **kwargs):
        with hierarchy_write(using=self.db):
            return super().update(**kwargs)

    def delete(self):
        with hierarchy_write(using=self.db):
            return super().delete()


class SectionTemplate(models.Model):
    """Reusable Site-scoped section preset for visual Page assembly."""

    objects = SectionTemplateQuerySet.as_manager()

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(
        "sites.Site",
        on_delete=models.PROTECT,
        related_name="section_templates",
    )
    name = models.CharField(max_length=120)
    status = models.CharField(
        max_length=16,
        choices=SectionTemplateStatus.choices,
        default=SectionTemplateStatus.ACTIVE,
    )
    schema_version = models.PositiveSmallIntegerField(default=CURRENT_LAYOUT_SCHEMA_VERSION)
    version = models.PositiveIntegerField(default=1)
    section = models.JSONField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_section_templates",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="updated_section_templates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["site", "status", "-updated_at"], name="cms_sectmpl_site_status_idx"),
            models.Index(fields=["site", "name"], name="cms_sectmpl_site_name_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=["ACTIVE", "RETIRED"]),
                name="cms_sectmpl_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(schema_version__gte=1),
                name="cms_sectmpl_schema_version_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name="cms_sectmpl_version_positive",
            ),
        ]

    def clean(self):
        super().clean()
        name = (self.name or "").strip()
        if not name:
            raise ValidationError({"name": "Provide a template name."})
        self.name = name
        if self.schema_version != CURRENT_LAYOUT_SCHEMA_VERSION:
            raise ValidationError({
                "schema_version": (
                    f"Section templates must use layout schema version "
                    f"{CURRENT_LAYOUT_SCHEMA_VERSION}."
                ),
            })
        layout = {"schema_version": CURRENT_LAYOUT_SCHEMA_VERSION, "rows": [self.section]}
        try:
            cleaned = validate_layout(layout, prefix="section")
        except ValidationError as error:
            raise ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        if len(cleaned["rows"]) != 1:
            raise ValidationError({"section": "A template stores exactly one section."})
        self.section = cleaned["rows"][0]
        self.schema_version = CURRENT_LAYOUT_SCHEMA_VERSION
        if self.site_id:
            try:
                validate_layout_media(cleaned, site_id=self.site_id)
            except ValidationError as error:
                raise ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error

    def save(self, *args, **kwargs):
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"updated_at"}
            return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} (v{self.version})"
