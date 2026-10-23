"""Institutional-unit validation, database integrity, and relation contracts."""
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, models, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from apps.organizations.models import OrganizationType, OrganizationUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def root():
    return OrganizationUnit.objects.create(
        code="UOG", name="University of Gondar",
        organization_type=OrganizationType.objects.get(code="UNIVERSITY"),
    )


def unit_values(root, **overrides):
    return {
        "code": "CMHS", "name": "College of Medicine and Health Sciences",
        "organization_type_id": OrganizationType.objects.get(code="COLLEGE").pk,
        "parent": root, **overrides,
    }


def test_unit_fields_relationships_and_identifier(root):
    unit = OrganizationUnit.objects.create(**unit_values(
        root, short_name="CMHS", description="Institutional college",
        metadata={"external_reference": "registry-1"},
    ))
    unit.refresh_from_db()
    assert isinstance(unit._meta.pk, models.BigAutoField)
    assert isinstance(unit.pk, int)
    assert unit.organization_type.code == "COLLEGE"
    assert unit.parent == root
    assert root.parent is None
    assert list(root.children.all()) == [unit]
    assert unit.short_name == "CMHS"
    assert unit.description == "Institutional college"
    assert unit.metadata == {"external_reference": "registry-1"}
    assert unit.status == "ACTIVE"
    assert str(unit) == unit.name
    assert unit.created_at and unit.updated_at
    assert timezone.is_aware(unit.created_at)
    assert not {"domain", "homepage", "theme", "template"} & {f.name for f in unit._meta.fields}


def test_normalized_code_is_unique(root):
    unit = OrganizationUnit.objects.create(**unit_values(root, code="  cmhs-1  "))
    assert unit.code == "CMHS-1"
    with pytest.raises(ValidationError):
        OrganizationUnit.objects.create(**unit_values(root, code=" cmhs-1 "))
    # Bypass save/full_clean to prove uniqueness is enforced in PostgreSQL.
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([OrganizationUnit(**unit_values(root, code="CMHS-1"))])


@pytest.mark.parametrize("code", ["", " ", "2ABC", "UNIT NAME", "A/B", "ÉCOLE", "A" * 65])
def test_invalid_codes_fail_validation(root, code):
    with pytest.raises(ValidationError):
        OrganizationUnit.objects.create(**unit_values(root, code=code))


@pytest.mark.parametrize("overrides", [
    {"name": ""}, {"name": " \t"}, {"name": None},
    {"organization_type_id": None}, {"organization_type_id": -1},
    {"parent_id": -1, "parent": None}, {"status": "UNKNOWN"},
    {"short_name": "A" * 101}, {"name": "A" * 256},
    {"metadata": []}, {"metadata": "text"}, {"metadata": None},
])
def test_invalid_fields_fail_validation(root, overrides):
    values = unit_values(root)
    if "parent_id" in overrides:
        values.pop("parent")
        overrides = {k: v for k, v in overrides.items() if k != "parent"}
    values.update(overrides)
    with pytest.raises(ValidationError):
        OrganizationUnit.objects.create(**values)


@pytest.mark.parametrize("overrides", [
    {"code": " cmhs "}, {"code": "lowercase"}, {"name": " \t"},
    {"status": "UNKNOWN"}, {"metadata": []}, {"metadata": 42},
    {"metadata": None}, {"organization_type_id": None},
])
def test_database_checks_cannot_be_bypassed(root, overrides):
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([OrganizationUnit(**unit_values(root, **overrides))])


@pytest.mark.parametrize("field", ["parent_id", "organization_type_id"])
def test_database_foreign_keys_reject_missing_references(root, field):
    values = unit_values(root)
    if field == "parent_id":
        values.pop("parent")
    values[field] = -1
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([OrganizationUnit(**values)])
        # Django creates deferrable foreign keys: force their database check
        # inside this savepoint rather than deferring to pytest teardown.
        connection.check_constraints()


def test_only_one_null_parent_root_is_allowed(root):
    values = unit_values(root, code="SECOND_ROOT", parent=None)
    with pytest.raises(ValidationError):
        OrganizationUnit.objects.create(**values)
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([OrganizationUnit(**values)])
    assert OrganizationUnit.objects.filter(parent__isnull=True).count() == 1


def test_code_immutability_is_enforced_by_model_and_database(root):
    root.code = "NEW_UOG"
    with pytest.raises(ValidationError, match="cannot be changed"):
        root.save()
    with pytest.raises(IntegrityError, match="cannot be changed"), transaction.atomic():
        OrganizationUnit.objects.filter(pk=root.pk).update(code="NEW_UOG")
    with pytest.raises(IntegrityError, match="cannot be changed"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("UPDATE organizations_organizationunit SET code=%s WHERE id=%s", ["NEW_UOG", root.pk])
    root.refresh_from_db()
    assert root.code == "UOG"


def test_parent_and_type_are_protected_while_in_use(root):
    unit = OrganizationUnit.objects.create(**unit_values(root))
    with pytest.raises(ValidationError):
        root.delete()
    with pytest.raises(ProtectedError):
        unit.organization_type.delete()
    with pytest.raises(ValidationError):
        unit.delete()
    assert OrganizationUnit.objects.filter(pk__in=[root.pk, unit.pk]).count() == 2


def test_metadata_defaults_do_not_leak_and_timestamps_track_changes(root):
    unit = OrganizationUnit.objects.create(**unit_values(root))
    unit.metadata["note"] = "local"
    assert root.metadata == {}
    created = unit.created_at
    modified = unit.updated_at
    with patch("django.utils.timezone.now", return_value=modified + timezone.timedelta(seconds=10)):
        unit.status = OrganizationUnit.Status.INACTIVE
        unit.save(update_fields=["status", "metadata"])
    unit.refresh_from_db()
    assert unit.updated_at > modified
    assert unit.created_at == created
    assert unit.status == "INACTIVE"
    assert unit.short_name == "" and unit.description == ""


def test_admin_freezes_code_and_database_indexes_cover_relations_and_status(root):
    model_admin = admin.site._registry[OrganizationUnit]
    assert "code" not in model_admin.get_readonly_fields(None)
    assert "code" in model_admin.get_readonly_fields(None, root)
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, OrganizationUnit._meta.db_table)
    assert constraints["organization_unit_code_uniq"]["unique"]
    assert constraints["organization_unit_single_root"]["unique"]
    assert constraints["org_unit_status_code_idx"]["columns"] == ["status", "code"]
    for column in ("parent_id", "organization_type_id"):
        assert any(c["index"] and c["columns"] == [column] for c in constraints.values())
