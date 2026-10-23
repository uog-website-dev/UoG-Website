"""DEC-04 invariants, including writes that bypass model validation."""
from importlib import import_module
from unittest.mock import patch

import pytest
from django.apps import apps
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, models, transaction
from django.db.models.deletion import ProtectedError
from django.utils.translation import override

from apps.organizations.models import OrganizationType


INITIAL_TYPES = {
    "UNIVERSITY": "University", "COLLEGE": "College", "SCHOOL": "School",
    "INSTITUTE": "Institute", "DEPARTMENT": "Department",
    "RESEARCH_CENTER": "Research Center", "DIRECTORATE": "Directorate",
    "OFFICE": "Office", "ADMINISTRATIVE_UNIT": "Administrative Unit", "OTHER": "Other",
}

pytestmark = pytest.mark.django_db


def test_initial_types_are_seeded():
    assert dict(OrganizationType.objects.values_list("code", "name")) == INITIAL_TYPES


@pytest.mark.parametrize("code", ["MUSEUM", "UNIT_2", "A"])
def test_administrators_can_add_valid_types_beyond_the_seed_set(code):
    organization_type = OrganizationType.objects.create(code=code, name="Custom institutional unit")
    organization_type.refresh_from_db()
    assert organization_type.code == code
    assert organization_type.name == "Custom institutional unit"


@pytest.mark.parametrize("code", ["", "college", "2_UNIT", "RESEARCH CENTER", "UNIT-1", "ÉCOLE", "A\n", "A" * 65])
def test_invalid_type_codes_are_rejected(code):
    with pytest.raises(ValidationError):
        OrganizationType.objects.create(code=code, name="Invalid unit")


@pytest.mark.parametrize("name", ["", " \t\n", None, "A" * 256])
def test_invalid_names_are_rejected(name):
    with pytest.raises(ValidationError):
        OrganizationType.objects.create(code="CUSTOM", name=name)


def test_duplicate_codes_rejected_by_validation_and_database():
    with pytest.raises(ValidationError):
        OrganizationType.objects.create(code="COLLEGE", name="Another college label")
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationType.objects.bulk_create([OrganizationType(code="COLLEGE", name="Duplicate")])


@pytest.mark.parametrize("code,name", [("lowercase", "Label"), ("", "Label"), ("A\n", "Label"), ("CUSTOM", " \t")])
def test_bulk_writes_cannot_bypass_database_validation(code, name):
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationType.objects.bulk_create([OrganizationType(code=code, name=name)])


def test_code_immutable_in_model_queryset_and_raw_sql():
    organization_type = OrganizationType.objects.get(code="COLLEGE")
    organization_type.code = "NEW_COLLEGE"
    with pytest.raises(ValidationError, match="cannot be changed"):
        organization_type.save()
    with pytest.raises(IntegrityError, match="cannot be changed"), transaction.atomic():
        OrganizationType.objects.filter(pk=organization_type.pk).update(code="NEW_COLLEGE")
    with pytest.raises(IntegrityError, match="cannot be changed"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE organizations_organizationtype SET code = %s WHERE id = %s",
                ["NEW_COLLEGE", organization_type.pk],
            )
    organization_type.refresh_from_db()
    assert organization_type.code == "COLLEGE"


def test_names_can_change_and_need_not_be_unique():
    organization_type = OrganizationType.objects.get(code="COLLEGE")
    organization_type.name = "College (updated label)"
    organization_type.save(update_fields=["name"])
    other = OrganizationType.objects.create(code="NEW_TYPE", name=organization_type.name)
    assert other.pk != organization_type.pk
    organization_type.refresh_from_db()
    assert organization_type.name == other.name
    assert organization_type.code == "COLLEGE"


def test_translation_is_presentation_only():
    organization_type = OrganizationType.objects.get(code="COLLEGE")
    with override("am"), patch(
        "apps.organizations.models.organization_type.gettext", return_value="Translated label",
    ):
        assert organization_type.display_name == "Translated label"
        assert str(organization_type) == "Translated label"
        assert organization_type.code == "COLLEGE"
        assert organization_type.name == "College"


def test_admin_code_is_editable_only_during_creation():
    model_admin = admin.site._registry[OrganizationType]
    assert "code" not in model_admin.get_readonly_fields(None)
    assert "code" in model_admin.get_readonly_fields(None, OrganizationType.objects.get(code="COLLEGE"))


def test_seed_can_be_reapplied_without_duplicates_or_overwriting_names():
    seed = import_module("apps.organizations.migrations.0002_seed_organization_types")
    OrganizationType.objects.filter(code="COLLEGE").update(name="Locally managed label")
    OrganizationType.objects.filter(code="OTHER").delete()
    with connection.schema_editor() as editor:
        seed.seed_types(apps, editor)
        seed.seed_types(apps, editor)
    assert OrganizationType.objects.count() == 10
    assert OrganizationType.objects.get(code="COLLEGE").name == "Locally managed label"
    assert OrganizationType.objects.get(code="OTHER").name == "Other"


@pytest.mark.django_db(transaction=True)
def test_future_unit_foreign_key_can_protect_a_referenced_type():
    # Exercise the real lookup through a temporary consumer, without adding a
    # speculative OrganizationUnit model or migration to production.
    class TypeReference(models.Model):
        organization_type = models.ForeignKey(OrganizationType, on_delete=models.PROTECT)

        class Meta:
            app_label = "organizations"

    table_created = False
    try:
        with connection.schema_editor() as editor:
            editor.create_model(TypeReference)
        table_created = True
        organization_type, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
        reference = TypeReference.objects.create(organization_type=organization_type)
        with pytest.raises(ProtectedError):
            organization_type.delete()
        with pytest.raises(ProtectedError):
            OrganizationType.objects.filter(pk=organization_type.pk).delete()
        # Even SQL bypassing Django's deletion collector must respect the FK.
        with pytest.raises(IntegrityError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM organizations_organizationtype WHERE id = %s", [organization_type.pk])
        reference.delete()
        organization_type.delete()
    finally:
        if table_created:
            with connection.schema_editor() as editor:
                editor.delete_model(TypeReference)
        apps.all_models["organizations"].pop("typereference", None)
        apps.clear_cache()
