"""Approved starting points for a Site. Applying one copies defaults once."""
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q, Value
from django.db.models.lookups import Exact

from ..configuration import default_configuration, normalize_site_configuration


class SiteTemplate(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    code = models.CharField(max_length=64, validators=[RegexValidator(
        r"\A[A-Z][A-Z0-9_-]{0,63}\Z", "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
    )], help_text="Globally unique, normalized to uppercase and immutable after creation.")
    name = models.CharField(max_length=255)
    description = models.TextField(help_text="What kind of website this template is for.")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.INACTIVE)
    default_configuration = models.JSONField(
        default=default_configuration, blank=True,
        help_text="Approved configuration copied onto a new Site. Later edits do not change existing Sites.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)
        constraints = [
            models.UniqueConstraint(fields=["code"], name="site_template_code_uniq"),
            models.CheckConstraint(condition=Q(code__regex=r"\A[A-Z][A-Z0-9_-]{0,63}\Z"), name="site_template_canonical_code"),
            models.CheckConstraint(condition=~Q(name__regex=r"^\s*$"), name="site_template_nonblank_name"),
            models.CheckConstraint(condition=~Q(description__regex=r"^\s*$"), name="site_template_nonblank_description"),
            models.CheckConstraint(condition=Q(status__in=["ACTIVE", "INACTIVE"]), name="site_template_status"),
            models.CheckConstraint(condition=Exact(models.Func("default_configuration", function="jsonb_typeof", output_field=models.CharField()), Value("object")), name="site_template_configuration_object"),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if isinstance(self.name, str) and not self.name.strip():
            raise ValidationError({"name": "A template name is required."})
        if isinstance(self.description, str) and not self.description.strip():
            raise ValidationError({"description": "A template description is required."})
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values_list("code", flat=True).first()
            if previous and previous != self.code:
                raise ValidationError({"code": "Template codes cannot be changed."})

    def full_clean(self, *args, **kwargs):
        if isinstance(self.code, str):
            self.code = self.code.strip().upper()
        if isinstance(self.name, str):
            self.name = self.name.strip()
        if isinstance(self.description, str):
            self.description = self.description.strip()
        language = _reference_language(self.default_configuration)
        self.default_configuration = normalize_site_configuration(self.default_configuration, default_language=language)
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        supplied = self.default_configuration
        self.full_clean()
        if kwargs.get("update_fields"):
            fields = set(kwargs["update_fields"]) | {"updated_at"}
            if self.default_configuration != supplied:
                fields.add("default_configuration")
            kwargs["update_fields"] = fields
        return super().save(*args, **kwargs)


def _reference_language(document):
    enabled = document.get("language", {}).get("enabled") if isinstance(document, dict) else None
    if isinstance(enabled, list) and enabled and isinstance(enabled[0], str):
        return enabled[0].strip().lower()
    return "en-us"
