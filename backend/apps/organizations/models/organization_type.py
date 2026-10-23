"""Institutional classifications owned exclusively by the organizations domain."""
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.utils.translation import gettext, gettext_lazy as _


class OrganizationType(models.Model):
    code = models.CharField(
        _("code"), max_length=64, unique=True,
        validators=[RegexValidator(
            regex=r"\A[A-Z][A-Z0-9_]{0,63}\Z",
            message=_("Use an uppercase letter followed by uppercase letters, digits or underscores."),
        )],
        help_text=_("Stable machine-readable code. Cannot be changed after creation."),
    )
    name = models.CharField(_("name"), max_length=255)

    class Meta:
        ordering = ("code",)
        verbose_name = _("organization type")
        verbose_name_plural = _("organization types")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(code__regex=r"\A[A-Z][A-Z0-9_]{0,63}\Z"),
                name="organization_type_valid_code",
            ),
            models.CheckConstraint(
                condition=~models.Q(name__regex=r"^\s*$"),
                name="organization_type_nonblank_name",
            ),
        ]

    @property
    def display_name(self):
        """Translate presentation labels without translating machine codes."""
        return gettext(self.name)

    def __str__(self):
        return self.display_name

    def clean(self):
        super().clean()
        if isinstance(self.name, str) and not self.name.strip():
            raise ValidationError({"name": _("A human-readable name is required.")})
        if self.pk is not None:
            previous = type(self).objects.filter(pk=self.pk).values_list("code", flat=True).first()
            if previous is not None and previous != self.code:
                raise ValidationError({"code": _("Organization type codes cannot be changed.")})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
