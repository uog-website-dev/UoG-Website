"""Central institutional units, independent of websites and their configuration."""
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, router
from django.db.models import Q, Value
from django.db.models.lookups import Exact
from django.utils.translation import gettext_lazy as _
from .querysets import OrganizationUnitQuerySet


class OrganizationUnit(models.Model):
    objects = OrganizationUnitQuerySet.as_manager()
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", _("Active")
        INACTIVE = "INACTIVE", _("Inactive")
        ARCHIVED = "ARCHIVED", _("Archived")

    code = models.CharField(
        _("code"), max_length=64,
        validators=[RegexValidator(
            regex=r"\A[A-Z][A-Z0-9_-]{0,63}\Z",
            message=_("Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens."),
        )],
        help_text=_("Whitespace is trimmed and letters uppercased. Immutable after creation."),
    )
    name = models.CharField(_("name"), max_length=255)
    short_name = models.CharField(_("short name"), max_length=100, blank=True)
    organization_type = models.ForeignKey(
        "organizations.OrganizationType", on_delete=models.PROTECT,
        related_name="organization_units", verbose_name=_("organization type"),
    )
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True,
        related_name="children", verbose_name=_("parent"),
        help_text=_("Leave empty only for the single institutional root."),
    )
    description = models.TextField(_("description"), blank=True)
    status = models.CharField(_("status"), max_length=8, choices=Status.choices, default=Status.ACTIVE)
    metadata = models.JSONField(_("metadata"), default=dict, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        ordering = ("code",)
        verbose_name = _("organization unit")
        verbose_name_plural = _("organization units")
        constraints = [
            # The format check forces canonical storage, so a plain unique
            # constraint is uniqueness on normalized codes without a redundant
            # functional index. Model writes normalize before validation.
            models.UniqueConstraint(fields=["code"], name="organization_unit_code_uniq"),
            models.CheckConstraint(
                condition=Q(code__regex=r"\A[A-Z][A-Z0-9_-]{0,63}\Z"),
                name="organization_unit_canonical_code",
            ),
            models.CheckConstraint(condition=~Q(name__regex=r"^\s*$"), name="organization_unit_nonblank_name"),
            models.CheckConstraint(condition=Q(status__in=["ACTIVE", "INACTIVE", "ARCHIVED"]), name="organization_unit_valid_status"),
            models.CheckConstraint(
                condition=Q(parent__isnull=False) | Q(status="ACTIVE"), name="organization_root_active",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("metadata", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="organization_unit_metadata_object",
            ),
            models.UniqueConstraint(
                Value(1), condition=Q(parent__isnull=True), name="organization_unit_single_root",
            ),
            models.CheckConstraint(
                condition=~Q(parent=models.F("id")), name="organization_unit_not_self_parent",
            ),
        ]
        indexes = [models.Index(fields=["status", "code"], name="org_unit_status_code_idx")]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if isinstance(self.code, str):
            self.code = self.code.strip().upper()
        if isinstance(self.name, str) and not self.name.strip():
            raise ValidationError({"name": _("An organization name is required.")})
        if not isinstance(self.metadata, dict):
            raise ValidationError({"metadata": _("Metadata must be a JSON object.")})
        if self.pk is not None:
            previous = type(self).objects.filter(pk=self.pk).values_list("code", flat=True).first()
            if previous is not None and previous != self.code:
                raise ValidationError({"code": _("Organization unit codes cannot be changed.")})
            if self.parent_id == self.pk:
                raise ValidationError({"parent": _("An organization unit cannot be its own parent.")})
            if self.parent_id is not None:
                from ..selectors.hierarchy import get_ancestors

                try:
                    ancestors = get_ancestors(
                        self.parent_id, include_self=True,
                        using=self._state.db or router.db_for_write(type(self), instance=self),
                    )
                except type(self).DoesNotExist:
                    raise ValidationError({"parent": _("The parent organization unit does not exist.")})
                if any(ancestor.pk == self.pk for ancestor in ancestors):
                    raise ValidationError({"parent": _("An organization unit cannot be moved under its descendant.")})
        if self.status in self.Status.values and self.organization_type_id is not None:
            from ..lifecycle_validation import validate_lifecycle

            validate_lifecycle(self, using=self._state.db or router.db_for_write(type(self), instance=self))

    def full_clean(self, *args, **kwargs):
        # clean_fields runs before clean(), so normalize before both field and
        # uniqueness validation, including when forms call full_clean directly.
        if isinstance(self.code, str):
            self.code = self.code.strip().upper()
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        from ..hierarchy_lock import hierarchy_write

        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"updated_at"}
            return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError(_("Organization units cannot be deleted. Deactivate and archive them instead."))
