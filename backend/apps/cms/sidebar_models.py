"""Reusable navigation regions; Page revisions freeze their presentation."""
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, router
from apps.organizations.hierarchy_lock import hierarchy_write


class Sidebar(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('sites.Site', on_delete=models.PROTECT, related_name='sidebars')
    name = models.CharField(max_length=120)
    status = models.CharField(max_length=16, choices=(('ACTIVE', 'Active'), ('ARCHIVED', 'Archived')), default='ACTIVE')
    components = models.JSONField(default=list)
    version = models.PositiveIntegerField(default=1, editable=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('name', 'id')
        constraints = [
            models.UniqueConstraint(fields=('site', 'name'), name='sidebar_site_name_unique'),
            models.CheckConstraint(condition=~models.Q(name=''), name='sidebar_name_required'),
            models.CheckConstraint(condition=models.Q(status__in=['ACTIVE', 'ARCHIVED']), name='sidebar_status_valid'),
        ]
        indexes = [models.Index(fields=('site', 'status'), name='sidebar_site_status_idx')]

    def clean(self):
        from .services.sidebars import validate_components
        if not isinstance(self.name, str):
            raise ValidationError({"name": "A sidebar name is required."})
        self.name = self.name.strip()
        if not self.name:
            raise ValidationError({"name": "A sidebar name is required."})
        self.components = validate_components(self.components, self.site_id)
        if self.pk and not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if old.site_id != self.site_id:
                raise ValidationError({'site': 'Sidebar ownership cannot change.'})
            if self.status == 'ARCHIVED' and self.pages.exists():
                raise ValidationError({'status': 'Remove all Page assignments before archiving this sidebar.'})

    def save(self, *args, **kwargs):
        using = kwargs.get('using') or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            result = super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"], using=using)
            return result

    def __str__(self):
        return self.name
