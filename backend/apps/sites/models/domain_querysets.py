"""Serialize domain writes so primary-hostname races meet the unique index."""
from django.db import models


class SiteDomainQuerySet(models.QuerySet):
    def update(self, **kwargs):
        from ..services.domains import domain_write
        with domain_write(using=self.db):
            return super().update(**kwargs)

    def bulk_create(self, objs, *args, **kwargs):
        from ..services.domains import domain_write
        with domain_write(using=self.db):
            return super().bulk_create(objs, *args, **kwargs)

    def bulk_update(self, objs, fields, batch_size=None):
        from ..services.domains import domain_write
        with domain_write(using=self.db):
            return super().bulk_update(objs, fields, batch_size=batch_size)
