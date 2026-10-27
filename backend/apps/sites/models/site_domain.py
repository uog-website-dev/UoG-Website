"""Hostnames for a Site. Configuration does not prove DNS or TLS exists."""
from django.core.exceptions import ValidationError
from django.db import models, router
from django.db.models import Q

from ..hostnames import normalize_hostname
from .domain_querysets import SiteDomainQuerySet


class SiteDomain(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    objects = SiteDomainQuerySet.as_manager()
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="domains")
    hostname = models.CharField(max_length=253, help_text="Normalized hostname. Not a URL, path or certificate claim.")
    is_primary = models.BooleanField(default=False)
    redirect_to_primary = models.BooleanField(default=False, help_text="Aliases may redirect. A primary domain cannot.")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.INACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("hostname",)
        constraints = [
            models.UniqueConstraint(fields=["hostname"], name="site_domain_hostname_uniq"),
            models.UniqueConstraint(fields=["site"], condition=Q(is_primary=True), name="site_domain_one_primary"),
            models.CheckConstraint(condition=Q(hostname__regex=r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"), name="site_domain_hostname_format"),
            models.CheckConstraint(condition=Q(status__in=["ACTIVE", "INACTIVE"]), name="site_domain_status"),
            models.CheckConstraint(condition=~Q(is_primary=True, redirect_to_primary=True), name="site_domain_primary_not_redirect"),
        ]

    def __str__(self):
        return self.hostname

    def clean(self):
        super().clean()
        if self.is_primary and self.redirect_to_primary:
            raise ValidationError({"redirect_to_primary": "A primary domain cannot redirect to itself."})
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values("hostname", "site_id").first()
            if previous and previous["hostname"] != self.hostname:
                raise ValidationError({"hostname": "Hostnames cannot be changed. Add another domain instead."})
            if previous and previous["site_id"] != self.site_id and not _reassignment_enabled():
                raise ValidationError({"site": "Move a domain with the reassignment operation."})
        if self.is_primary and type(self).objects.filter(site_id=self.site_id, is_primary=True).exclude(pk=self.pk).exists():
            raise ValidationError({"is_primary": "This Site already has a primary domain."})
        if self.status == self.Status.ACTIVE and self.site_id and self.site.status == "ARCHIVED":
            raise ValidationError({"status": "An archived Site cannot have an active domain."})

    def full_clean(self, *args, **kwargs):
        self.hostname = normalize_hostname(self.hostname)
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        from ..services.domains import domain_write
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with domain_write(using=using):
            self.full_clean()
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"updated_at"}
            return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.is_primary or self.status != self.Status.INACTIVE:
            raise ValidationError("Deactivate the domain and clear its primary designation before removing it.")
        from ..services.domains import domain_write
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with domain_write(using=using):
            return super().delete(*args, **kwargs)


def _reassignment_enabled():
    from ..services.domains import domain_reassignment_enabled
    return domain_reassignment_enabled()
