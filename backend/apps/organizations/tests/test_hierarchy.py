"""Traversal, database integrity, rollback, and real concurrent inverse moves."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, close_old_connections, connections, transaction
from django.db.migrations.executor import MigrationExecutor

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.organizations.selectors.hierarchy import (
    get_ancestors, get_children, get_descendants, get_parent, get_root, get_subtree,
)
from apps.organizations.services.hierarchy import move_unit

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    def create(code, name, type_code, parent=None):
        organization_type, _ = OrganizationType.objects.get_or_create(
            code=type_code, defaults={"name": type_code.replace("_", " ").title()},
        )
        return OrganizationUnit.objects.create(
            code=code, name=name, organization_type=organization_type, parent=parent,
        )

    root = create("UOG", "University of Gondar", "UNIVERSITY")
    college = create("CI", "College of Informatics", "COLLEGE", root)
    other = create("CM", "College of Medicine", "COLLEGE", root)
    department = create("CS", "Department of Computer Science", "DEPARTMENT", college)
    sibling = create("IS", "Department of Information Systems", "DEPARTMENT", college)
    center = create("RC", "Research Center", "RESEARCH_CENTER", root)
    directorate = create("DIR", "Directorate", "DIRECTORATE", root)
    return {"root": root, "college": college, "other": other, "department": department,
            "sibling": sibling, "center": center, "directorate": directorate}


def codes(units):
    return [unit.code for unit in units]


def test_three_levels_parent_children_ancestors_and_root(tree):
    assert get_parent(tree["root"].pk) is None
    assert get_parent(tree["department"].pk) == tree["college"]
    assert codes(get_children(tree["root"].pk)) == ["CI", "CM", "DIR", "RC"]
    assert codes(get_children(tree["college"].pk)) == ["CS", "IS"]
    assert codes(get_ancestors(tree["department"].pk)) == ["UOG", "CI"]
    assert codes(get_ancestors(tree["department"].pk, include_self=True)) == ["UOG", "CI", "CS"]
    assert get_ancestors(tree["root"].pk) == []
    for unit in tree.values():
        assert get_root(unit.pk) == tree["root"]


def test_descendants_and_subtree_are_complete_and_ordered(tree, django_assert_num_queries):
    with django_assert_num_queries(1):
        descendants = get_descendants(tree["root"].pk)
    assert codes(descendants) == ["CI", "CM", "DIR", "RC", "CS", "IS"]
    with django_assert_num_queries(1):
        ancestors = get_ancestors(tree["department"].pk)
    assert codes(ancestors) == ["UOG", "CI"]
    with django_assert_num_queries(1):
        subtree = get_subtree(tree["college"].pk)
    assert codes(subtree) == ["CI", "CS", "IS"]
    assert get_descendants(tree["department"].pk) == []
    assert codes(get_subtree(tree["department"].pk)) == ["CS"]


@pytest.mark.parametrize("selector", [get_parent, get_root, get_ancestors, get_descendants, get_subtree])
def test_traversal_of_missing_units_raises(selector):
    with pytest.raises(OrganizationUnit.DoesNotExist):
        selector(-1)
    assert list(get_children(-1)) == []


def test_model_and_service_deny_self_parenting_and_descendant_parenting(tree):
    college = tree["college"]
    college.parent_id = college.pk
    with pytest.raises(ValidationError, match="own parent"):
        college.save()
    with pytest.raises(ValidationError, match="descendant"):
        move_unit(tree["college"].pk, parent_id=tree["department"].pk)
    with pytest.raises(ValidationError):
        move_unit(tree["root"].pk, parent_id=tree["department"].pk)
    college.refresh_from_db()
    assert college.parent == tree["root"]


def test_valid_move_updates_subtree_and_is_rolled_back_atomically(tree):
    moved = move_unit(tree["college"].pk, parent_id=tree["other"].pk)
    assert moved.parent_id == tree["other"].pk
    assert codes(get_ancestors(tree["department"].pk)) == ["UOG", "CM", "CI"]
    assert codes(get_subtree(tree["other"].pk)) == ["CM", "CI", "CS", "IS"]
    with pytest.raises(RuntimeError), transaction.atomic():
        move_unit(tree["college"].pk, parent_id=tree["root"].pk)
        raise RuntimeError("Roll back the entire business operation")
    assert get_parent(tree["college"].pk) == tree["other"]


def test_new_root_and_nonexistent_parent_moves_are_rejected(tree):
    with pytest.raises(ValidationError):
        move_unit(tree["college"].pk, parent_id=None)
    with pytest.raises(ValidationError):
        move_unit(tree["college"].pk, parent_id=-1)
    assert get_parent(tree["college"].pk) == tree["root"]


@pytest.mark.parametrize("writer", ["queryset", "bulk_update", "sql"])
def test_database_rejects_cycle_when_model_validation_is_bypassed(tree, writer):
    college, department = tree["college"], tree["department"]
    with pytest.raises(IntegrityError), transaction.atomic():
        if writer == "queryset":
            OrganizationUnit.objects.filter(pk=college.pk).update(parent_id=department.pk)
        elif writer == "bulk_update":
            college.parent_id = department.pk
            OrganizationUnit.objects.bulk_update([college], ["parent"])
        else:
            with connections["default"].cursor() as cursor:
                cursor.execute("UPDATE organizations_organizationunit SET parent_id=%s WHERE id=%s",
                               [department.pk, college.pk])
    assert get_parent(college.pk) == tree["root"]


def test_bulk_insert_cannot_create_self_parenting_or_mutual_cycle(tree):
    type_id = tree["college"].organization_type_id
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([
            OrganizationUnit(id=100001, code="SELF", name="Self", organization_type_id=type_id, parent_id=100001),
        ])
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([
            OrganizationUnit(id=100002, code="CYCLE_A", name="A", organization_type_id=type_id, parent_id=100003),
            OrganizationUnit(id=100003, code="CYCLE_B", name="B", organization_type_id=type_id, parent_id=100002),
        ])
    assert not OrganizationUnit.objects.filter(code__startswith="CYCLE_").exists()


def test_missing_guard_fails_closed_and_rolls_back(tree):
    with pytest.raises(IntegrityError, match="guard is missing"), transaction.atomic():
        with connections["default"].cursor() as cursor:
            cursor.execute("DELETE FROM organizations_hierarchy_guard")
        move_unit(tree["college"].pk, parent_id=tree["other"].pk)
    assert get_parent(tree["college"].pk) == tree["root"]


@pytest.mark.django_db(transaction=True)
def test_migration_rejects_legacy_cycles_and_can_be_reapplied():
    connection = connections["default"]
    executor = MigrationExecutor(connection)
    old_target = [("organizations", "0003_organizationunit")]
    new_target = [("organizations", "0006_audit_events")]
    executor.migrate(old_target)
    old_apps = executor.loader.project_state(old_target).apps
    OldType = old_apps.get_model("organizations", "OrganizationType")
    OldUnit = old_apps.get_model("organizations", "OrganizationUnit")
    college = None
    root = None
    try:
        university_type, _ = OldType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
        college_type, _ = OldType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
        root = OldUnit.objects.create(code="LEGACY_ROOT", name="Legacy root", organization_type=university_type)
        college = OldUnit.objects.create(code="LEGACY_A", name="Legacy A", organization_type=college_type, parent=root)
        other = OldUnit.objects.create(code="LEGACY_B", name="Legacy B", organization_type=college_type, parent=college)
        OldUnit.objects.filter(pk=college.pk).update(parent_id=other.pk)
        with pytest.raises(IntegrityError, match="Existing organization hierarchy contains a cycle"):
            MigrationExecutor(connection).migrate(new_target)
    finally:
        # Restore valid legacy data and restore the migration before other
        # tests execute. This also exercises the reverse and forward DDL.
        if college is not None and root is not None:
            OldUnit.objects.filter(pk=college.pk).update(parent_id=root.pk)
        MigrationExecutor(connection).migrate(new_target)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("isolation", ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])
@pytest.mark.parametrize("writer", ["service", "sql"])
def test_simultaneous_inverse_moves_never_commit_a_cycle(tree, isolation, writer):
    first, second = tree["college"].pk, tree["other"].pk
    barrier = Barrier(3)

    def attempt(unit_id, parent_id):
        close_old_connections()
        try:
            with transaction.atomic():
                with connections["default"].cursor() as cursor:
                    # Isolation is a fixed test parameter, not user input.
                    cursor.execute("SET TRANSACTION ISOLATION LEVEL " + isolation)
                    cursor.execute("SET LOCAL lock_timeout = '5s'")
                    cursor.execute("SET LOCAL statement_timeout = '10s'")
                # Establish the pre-move snapshot for both connections before
                # the barrier, including at repeatable-read/serializable.
                OrganizationUnit.objects.get(pk=unit_id)
                barrier.wait(timeout=10)
                if writer == "service":
                    move_unit(unit_id, parent_id=parent_id)
                else:
                    with connections["default"].cursor() as cursor:
                        cursor.execute("UPDATE organizations_organizationunit SET parent_id=%s WHERE id=%s",
                                       [parent_id, unit_id])
            return "committed", None
        except ValidationError:
            return "rejected", "validation"
        except (IntegrityError, OperationalError) as exc:
            return "rejected", getattr(exc.__cause__, "sqlstate", None)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt, first, second), executor.submit(attempt, second, first)]
        barrier.wait(timeout=10)
        results = [future.result(timeout=20) for future in futures]
    assert [status for status, _ in results].count("committed") == 1, results
    assert [status for status, _ in results].count("rejected") == 1, results
    rejected_code = next(code for status, code in results if status == "rejected")
    expected_code = ("validation" if writer == "service" else "23514") if isolation == "READ COMMITTED" else "40001"
    assert rejected_code == expected_code, results
    parents = dict(OrganizationUnit.objects.filter(pk__in=[first, second]).values_list("id", "parent_id"))
    assert not (parents[first] == second and parents[second] == first)
    assert get_root(first).pk == tree["root"].pk
    assert get_root(second).pk == tree["root"].pk
