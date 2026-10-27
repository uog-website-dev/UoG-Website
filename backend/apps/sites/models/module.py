"""Platform capabilities. A registry row is not itself a working feature."""
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, router
from django.db.models import Q, Value
from django.db.models.lookups import Exact

from ..module_schema import empty_module_schema, normalize_module_schema

_TRANSITIONS = {
    "PLANNED": {"PLANNED", "IMPLEMENTED", "DEPRECATED"},
    "IMPLEMENTED": {"IMPLEMENTED", "DEPRECATED"},
    "DEPRECATED": {"DEPRECATED", "IMPLEMENTED"},
}


class Module(models.Model):
    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        IMPLEMENTED = "IMPLEMENTED", "Implemented"
        DEPRECATED = "DEPRECATED", "Deprecated"

    code = models.CharField(max_length=64, validators=[RegexValidator(
        r"\A[A-Z][A-Z0-9_-]{0,63}\Z", "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
    )], help_text="Globally unique registry code, immutable after creation.")
    name = models.CharField(max_length=255)
    description = models.TextField(help_text="What this capability is. A planned module is not available to Sites.")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    is_enabled = models.BooleanField(default=False, help_text="Global switch. Only an implemented module can be enabled.")
    configuration_schema = models.JSONField(
        default=empty_module_schema, blank=True,
        help_text="Approved settings shape for a shipped module. Empty until a schema is approved.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)
        constraints = [
            models.UniqueConstraint(fields=["code"], name="module_code_uniq"),
            models.CheckConstraint(condition=Q(code__regex=r"\A[A-Z][A-Z0-9_-]{0,63}\Z"), name="module_canonical_code"),
            models.CheckConstraint(condition=~Q(name__regex=r"^\s*$"), name="module_nonblank_name"),
            models.CheckConstraint(condition=~Q(description__regex=r"^\s*$"), name="module_nonblank_description"),
            models.CheckConstraint(condition=Q(status__in=["PLANNED", "IMPLEMENTED", "DEPRECATED"]), name="module_status"),
            models.CheckConstraint(condition=Q(is_enabled=False) | Q(status="IMPLEMENTED"), name="module_enabled_requires_implemented"),
            models.CheckConstraint(condition=Exact(models.Func("configuration_schema", function="jsonb_typeof", output_field=models.CharField()), Value("object")), name="module_configuration_schema_object"),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if isinstance(self.name, str) and not self.name.strip():
            raise ValidationError({"name": "A module name is required."})
        if isinstance(self.description, str) and not self.description.strip():
            raise ValidationError({"description": "A module description is required."})
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values_list("status", "code").first()
            if previous and previous[1] != self.code:
                raise ValidationError({"code": "Module codes cannot be changed."})
            if previous and self.status not in _TRANSITIONS[previous[0]]:
                raise ValidationError({"status": "That module status change is not allowed."})
        if self.status == self.Status.IMPLEMENTED:
            from ..selectors.modules import capability_is_shipped
            using = self._state.db or router.db_for_write(type(self), instance=self)
            if not capability_is_shipped(self.code, using=using):
                raise ValidationError({"status": "This capability is not implemented."})
        if self.is_enabled and self.status != self.Status.IMPLEMENTED:
            raise ValidationError({"is_enabled": "Only an implemented module can be enabled."})

    def full_clean(self, *args, **kwargs):
        if isinstance(self.code, str):
            self.code = self.code.strip().upper()
        if isinstance(self.name, str):
            self.name = self.name.strip()
        if isinstance(self.description, str):
            self.description = self.description.strip()
        self.configuration_schema = normalize_module_schema(self.configuration_schema)
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        supplied = self.configuration_schema
        self.full_clean()
        if kwargs.get("update_fields"):
            fields = set(kwargs["update_fields"]) | {"updated_at"}
            if self.configuration_schema != supplied:
                fields.add("configuration_schema")
            kwargs["update_fields"] = fields
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Modules cannot be deleted. Deprecate them instead.")
