"""One Site's enablement of one registry Module.

Disabling sets is_enabled false. The row and its configuration stay, so later
module data is not removed by turning the capability off.
"""
from django.core.exceptions import ValidationError
from django.db import models, router
from django.db.models import Q

from ..module_schema import empty_site_module_configuration, normalize_site_module_configuration


class SiteModule(models.Model):
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="site_modules")
    module = models.ForeignKey("sites.Module", on_delete=models.PROTECT, related_name="site_modules")
    is_enabled = models.BooleanField(default=True)
    configuration = models.JSONField(default=empty_site_module_configuration, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("site_id", "module_id")
        constraints = [
            models.UniqueConstraint(fields=["site", "module"], name="site_module_uniq"),
        ]
        indexes = [
            models.Index(fields=["site"], name="site_module_enabled_site", condition=Q(is_enabled=True)),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.module_id}"

    def clean(self):
        super().clean()
        if not self.module_id or not self.site_id:
            return
        previous = None
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values("module_id", "site_id", "is_enabled").first()
            if previous and (previous["module_id"] != self.module_id or previous["site_id"] != self.site_id):
                raise ValidationError("A Site module assignment cannot be moved.")
        turning_on = self.is_enabled and (previous is None or not previous["is_enabled"])
        if not turning_on:
            return
        from ..selectors.modules import module_is_usable
        using = self._state.db or router.db_for_write(type(self), instance=self)
        if not module_is_usable(self.module, using=using):
            raise ValidationError({"module": "A disabled or unimplemented module cannot be enabled for a Site."})

    def full_clean(self, *args, **kwargs):
        if self.module_id:
            schema = self.module.configuration_schema
            self.configuration = normalize_site_module_configuration(schema, self.configuration)
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        supplied = self.configuration
        self.full_clean()
        if kwargs.get("update_fields"):
            fields = set(kwargs["update_fields"]) | {"updated_at"}
            if self.configuration != supplied:
                fields.add("configuration")
            kwargs["update_fields"] = fields
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Disabling a Site module keeps its configuration. Turn it off instead of deleting it.")
