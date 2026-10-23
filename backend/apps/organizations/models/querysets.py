"""Attach task/request audit context to ORM bulk mutations as well as saves."""
from django.db import models


class OrganizationUnitQuerySet(models.QuerySet):
    def update(self, **kwargs):
        from ..hierarchy_lock import hierarchy_write
        with hierarchy_write(using=self.db):
            return super().update(**kwargs)

    def bulk_create(self, objs, *args, **kwargs):
        from ..hierarchy_lock import hierarchy_write
        with hierarchy_write(using=self.db):
            return super().bulk_create(objs, *args, **kwargs)

    def bulk_update(self, objs, fields, batch_size=None):
        from ..hierarchy_lock import hierarchy_write
        with hierarchy_write(using=self.db):
            return super().bulk_update(objs, fields, batch_size=batch_size)
