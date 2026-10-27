"""Digital properties reference institutional owners without duplicating them."""
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, router
from django.db.models import Q, Value
from django.db.models.lookups import Exact

from ..configuration import default_configuration
from .querysets import SiteQuerySet


class Site(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        SUSPENDED = "SUSPENDED", "Suspended"
        ARCHIVED = "ARCHIVED", "Archived"

    objects = SiteQuerySet.as_manager()
    organization_unit = models.ForeignKey(
        "organizations.OrganizationUnit", on_delete=models.PROTECT, related_name="sites",
    )
    code = models.CharField(max_length=64, validators=[RegexValidator(
        r"\A[A-Z][A-Z0-9_-]{0,63}\Z", "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
    )], help_text="Globally unique, normalized to uppercase and immutable after creation.")
    name = models.CharField(max_length=255)
    short_name = models.CharField(max_length=100, blank=True)
    default_language = models.CharField(max_length=35, default="en-us", validators=[RegexValidator(
        r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z", "Use a normalized language code such as en, am or en-us.",
    )])
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.DRAFT)
    configuration = models.JSONField(
        default=default_configuration, blank=True,
        help_text="Versioned allowlisted settings. Empty objects receive schema version 1 defaults.",
    )
    template = models.ForeignKey(
        "sites.SiteTemplate", null=True, blank=True, on_delete=models.PROTECT, related_name="sites",
        help_text="Template whose defaults were copied at provisioning. Later template edits do not change this Site.",
    )
    is_main = models.BooleanField(default=False, help_text="Main university property; must belong to the UNIVERSITY root.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)
        constraints = [
            models.UniqueConstraint(fields=["code"], name="site_code_uniq"),
            models.CheckConstraint(condition=Q(code__regex=r"\A[A-Z][A-Z0-9_-]{0,63}\Z"), name="site_canonical_code"),
            models.CheckConstraint(condition=~Q(name__regex=r"^\s*$"), name="site_nonblank_name"),
            models.CheckConstraint(condition=Q(default_language__regex=r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z"), name="site_language_format"),
            models.CheckConstraint(condition=Q(status__in=["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"]), name="site_valid_status"),
            models.CheckConstraint(condition=Exact(models.Func("configuration", function="jsonb_typeof", output_field=models.CharField()), Value("object")), name="site_configuration_object"),
            models.UniqueConstraint(Value(1), condition=Q(is_main=True) & ~Q(status="ARCHIVED"), name="site_one_current_main"),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if isinstance(self.name, str) and not self.name.strip():
            raise ValidationError({"name": "A Site name is required."})
        if not isinstance(self.configuration, dict):
            raise ValidationError({"configuration": "Configuration must be a JSON object."})
        if self.template_id:
            from ..services.templates import reject_unselectable_template
            reject_unselectable_template(self)
        if type(self.organization_unit_id) is int and self.status in self.Status.values and isinstance(self.code, str) and isinstance(self.is_main, bool):
            from ..validation import validate_site
            validate_site(self, using=self._state.db or router.db_for_write(type(self), instance=self))

    def full_clean(self, *args, **kwargs):
        if isinstance(self.code, str):
            self.code = self.code.strip().upper()
        if isinstance(self.default_language, str):
            self.default_language = self.default_language.strip().lower()
        from ..services.templates import configuration_for_new_site
        self.configuration = configuration_for_new_site(self)
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        supplied = self.configuration
        with hierarchy_write(using=using):
            self.full_clean()
            if kwargs.get("update_fields"):
                fields = set(kwargs["update_fields"]) | {"updated_at"}
                if self.configuration != supplied:
                    fields.add("configuration")
                kwargs["update_fields"] = fields
            return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Sites cannot be deleted. Suspend or archive them instead.")
