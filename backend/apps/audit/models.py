"""Durable records retain identifiers independently of user/entity deletion."""
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class AuditEvent(models.Model):
    actor_kind = models.CharField(max_length=6, choices=[("USER", "User"), ("SYSTEM", "System")])
    actor_id = models.CharField(max_length=255)
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100)
    entity_id = models.CharField(max_length=255)
    timestamp = models.DateTimeField(default=timezone.now, editable=False)
    request_id = models.UUIDField(null=True, editable=False)
    ip = models.GenericIPAddressField(null=True, editable=False)
    before = models.JSONField(null=True)
    after = models.JSONField(null=True)
    changed_fields = models.JSONField(default=list)

    class Meta:
        ordering = ("timestamp", "id")
        indexes = [
            models.Index(fields=["entity_type", "entity_id", "timestamp"], name="audit_entity_time_idx"),
            models.Index(fields=["request_id"], name="audit_request_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(actor_kind__in=["USER", "SYSTEM"]), name="audit_valid_actor_kind"),
            models.CheckConstraint(condition=~Q(actor_id=""), name="audit_actor_required"),
            models.CheckConstraint(condition=~Q(entity_type="") & ~Q(entity_id="") & ~Q(action=""), name="audit_identity_required"),
        ]

    def save(self, *args, **kwargs):
        raise ValidationError("Use the common audit writer. Audit records are append-only.")

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit records are append-only.")
