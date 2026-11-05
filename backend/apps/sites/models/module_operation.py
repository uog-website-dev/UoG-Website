"""Registry dependencies and the history of central module operations.

Activation state lives only on SiteModule. These rows describe which modules
need others, and record what an operation changed; they never decide whether
a module runs on a Site.
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models, router
from django.db.models import F, Q


class ModuleDependency(models.Model):
    module = models.ForeignKey("sites.Module", on_delete=models.PROTECT, related_name="dependency_links")
    requires = models.ForeignKey("sites.Module", on_delete=models.PROTECT, related_name="dependent_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("module_id", "requires_id")
        constraints = [
            models.UniqueConstraint(fields=["module", "requires"], name="module_dependency_uniq"),
            models.CheckConstraint(condition=~Q(module=F("requires")), name="module_dependency_not_self"),
        ]

    def __str__(self):
        return f"{self.module_id} requires {self.requires_id}"

    def clean(self):
        super().clean()
        if not self.module_id or not self.requires_id:
            return
        using = self._state.db or router.db_for_write(type(self), instance=self)
        edges = list(type(self).objects.using(using).exclude(pk=self.pk).values_list("module_id", "requires_id"))
        pending, seen = [self.requires_id], set()
        while pending:
            node = pending.pop()
            if node == self.module_id:
                raise ValidationError({"requires": "Module dependencies cannot contain cycles."})
            if node not in seen:
                seen.add(node)
                pending.extend(target for source, target in edges if source == node)
        from .site_module import SiteModule
        required_sites = SiteModule.objects.using(using).filter(module_id=self.requires_id, is_enabled=True).values("site_id")
        if SiteModule.objects.using(using).filter(module_id=self.module_id, is_enabled=True).exclude(site_id__in=required_sites).exists():
            raise ValidationError({"requires": "Enable the required module on existing dependent Sites first."})

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            return super().save(*args, **kwargs)


class SiteModuleOperation(models.Model):
    class Action(models.TextChoices):
        ENABLE = "ENABLE", "Enable"
        DISABLE = "DISABLE", "Disable"

    class ScopeType(models.TextChoices):
        SITE = "SITE", "Individual Site"
        SELECTED = "SELECTED", "Selected Sites"
        ALL = "ALL", "All Sites"
        FILTER = "FILTER", "All matching Sites"
        ORGANIZATION = "ORGANIZATION", "Organization"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    idempotency_key = models.UUIDField()
    actor_id = models.CharField(max_length=255)
    action = models.CharField(max_length=7, choices=Action.choices)
    module_codes = models.JSONField(default=list)
    scope_type = models.CharField(max_length=12, choices=ScopeType.choices)
    scope = models.JSONField(default=dict)
    reason = models.CharField(max_length=500, blank=True)
    request_id = models.UUIDField(null=True, blank=True)
    request_fingerprint = models.CharField(max_length=64)
    matched_count = models.PositiveIntegerField(default=0)
    changed_site_count = models.PositiveIntegerField(default=0)
    unchanged_count = models.PositiveIntegerField(default=0)
    blocked_count = models.PositiveIntegerField(default=0)
    change_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["actor_id", "idempotency_key"], name="site_module_operation_idempotency"),
            models.CheckConstraint(condition=Q(action__in=["ENABLE", "DISABLE"]), name="site_module_operation_action"),
        ]
        indexes = [models.Index(fields=["created_at"], name="site_module_operation_time")]

    def __str__(self):
        return f"{self.action} {','.join(self.module_codes)} ({self.pk})"

    def delete(self, *args, **kwargs):
        raise ValidationError("Module operation history is append-only.")


class SiteModuleOperationChange(models.Model):
    class State(models.TextChoices):
        NOT_ASSIGNED = "NOT_ASSIGNED", "Not assigned"
        ENABLED = "ENABLED", "Enabled"
        DISABLED = "DISABLED", "Disabled"

    operation = models.ForeignKey(SiteModuleOperation, on_delete=models.PROTECT, related_name="changes")
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="module_operation_changes")
    module = models.ForeignKey("sites.Module", on_delete=models.PROTECT, related_name="operation_changes")
    previous_state = models.CharField(max_length=12, choices=State.choices)
    new_state = models.CharField(max_length=12, choices=State.choices)

    class Meta:
        ordering = ("site_id", "module_id")
        constraints = [
            models.UniqueConstraint(fields=["operation", "site", "module"], name="site_module_operation_change_uniq"),
            models.CheckConstraint(condition=~Q(previous_state=F("new_state")), name="site_module_operation_change_differs"),
            models.CheckConstraint(condition=Q(new_state__in=["ENABLED", "DISABLED"]), name="site_module_operation_change_new_state"),
        ]

    def delete(self, *args, **kwargs):
        raise ValidationError("Module operation history is append-only.")
