"""Site persistence, real PostgreSQL integrity and Organization integration."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connection, connections, models, transaction

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.organizations.services.lifecycle import archive_unit, deactivate_unit
from apps.sites.models import Site
from apps.sites.services.lifecycle import activate_site, archive_site, suspend_site, transition_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def owners():
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    medicine = OrganizationUnit.objects.create(code="CM", name="College of Medicine", organization_type=college, parent=root)
    return root, informatics, medicine


@pytest.fixture
def site(owners):
    return Site.objects.create(organization_unit=owners[1], code=" informatics ", name="Informatics Website", short_name="CoI")


def test_site_fields_owner_and_organization_independence(site, owners):
    site.refresh_from_db()
    assert isinstance(site._meta.pk, models.BigAutoField)
    assert site.code == "INFORMATICS" and site.status == "DRAFT"
    assert site.default_language == "en-us"
    assert site.created_at and site.updated_at
    assert site.organization_unit == owners[1]
    assert site._meta.get_field("organization_unit").remote_field.on_delete is models.PROTECT
    assert list(owners[1].sites.all()) == [site]
    assert not owners[2].sites.exists()  # A unit needs no digital property.
    assert str(site) == "Informatics Website"
    assert site.template_id is None
    assert not {"organization_type", "parent", "domain", "homepage", "theme"} & {field.name for field in Site._meta.fields}
    assert not {"site", "configuration", "default_language"} & {field.name for field in OrganizationUnit._meta.fields}
    assert Site.objects.create(organization_unit=owners[1], code="RESEARCH_PORTAL", name="Another digital property").pk != site.pk


def test_template_relationship_is_a_nullable_provenance_link():
    from django.db import models as django_models

    field = Site._meta.get_field("template")
    assert field.null and field.blank
    assert field.remote_field.on_delete is django_models.PROTECT
    assert {model.__name__ for model in apps.get_app_config("sites").get_models()} == {"Module", "Site", "SiteDomain", "SiteModule", "SiteTemplate"}


def test_global_code_uniqueness_normalization_and_immutability(site, owners):
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=owners[2], code=" informatics ", name="Duplicate code")
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.bulk_create([Site(organization_unit=owners[2], code="INFORMATICS", name="SQL duplicate")])
    assert Site.objects.count() == 1
    site.code = "NEW_CODE"
    with pytest.raises(ValidationError):
        site.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=site.pk).update(code="NEW_CODE")


@pytest.mark.parametrize("code", ["", " ", "2SITE", "BAD CODE", "ÉCOLE", "A" * 65])
def test_invalid_codes_rejected(owners, code):
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=owners[1], code=code, name="Website")


@pytest.mark.parametrize("language,expected", [("en", "en"), ("am", "am"), (" EN-US ", "en-us"), ("zh-hant", "zh-hant")])
def test_default_language_storage(owners, language, expected):
    value = Site.objects.create(organization_unit=owners[1], code="LANG", name="Localized property", default_language=language)
    value.refresh_from_db()
    assert value.default_language == expected


@pytest.mark.parametrize("overrides", [{"name": ""}, {"name": "  "}, {"organization_unit": None}, {"organization_unit_id": 999999999}, {"default_language": "en_US"}, {"default_language": "english"}, {"status": "UNKNOWN"}, {"configuration": []}, {"configuration": "text"}, {"configuration": None}])
def test_required_fields_and_valid_types_enforced(owners, overrides):
    values = {"organization_unit_id": owners[1].pk, "code": "INVALID", "name": "Website"}
    if "organization_unit" in overrides:
        values.pop("organization_unit_id")
    with pytest.raises(ValidationError):
        Site.objects.create(**{**values, **overrides})


@pytest.mark.parametrize("overrides", [{"code": "lowercase"}, {"name": " "}, {"default_language": "INVALID_LANGUAGE"}, {"configuration": []}, {"status": "ACTIVE"}, {"organization_unit_id": 999999999}])
def test_database_rejects_invalid_bulk_inserts(owners, overrides):
    values = {"organization_unit_id": owners[1].pk, "code": "INVALID", "name": "Website"}
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.bulk_create([Site(**{**values, **overrides})])
    assert not Site.objects.exists()


def test_main_site_must_belong_to_university_root_and_current_main_is_unique(owners):
    root, college, _ = owners
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=college, code="BAD_MAIN", name="Main", is_main=True)
    main = Site.objects.create(organization_unit=root, code="MAIN", name="University website", is_main=True)
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=root, code="SECOND_MAIN", name="Second main", is_main=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=main.pk).update(organization_unit_id=college.pk)
    archive_site(main.pk)
    replacement = Site.objects.create(organization_unit=root, code="NEW_MAIN", name="Replacement", is_main=True)
    assert replacement.pk != main.pk
    assert Site.objects.filter(is_main=True).count() == 2  # Archived designation is historical.


def test_suspend_reactivate_and_archive_preserve_data(site):
    original_id, original_created, config = site.pk, site.created_at, site.configuration
    active = activate_site(site.pk)
    assert active.status == "ACTIVE"
    assert suspend_site(site.pk).status == "SUSPENDED"
    assert activate_site(site.pk).status == "ACTIVE"
    archived = archive_site(site.pk)
    assert archived.status == "ARCHIVED"
    assert archived.pk == original_id and archived.created_at == original_created
    assert archived.configuration == config
    assert archived.updated_at > original_created
    assert archive_site(site.pk).status == "ARCHIVED"


@pytest.mark.parametrize("initial,target", [("DRAFT", "SUSPENDED"), ("ACTIVE", "DRAFT"), ("SUSPENDED", "DRAFT"), ("ARCHIVED", "ACTIVE"), ("ARCHIVED", "DRAFT"), ("ARCHIVED", "SUSPENDED")])
def test_invalid_lifecycle_transitions_denied(site, initial, target):
    if initial in {"ACTIVE", "SUSPENDED"}:
        activate_site(site.pk)
    if initial == "SUSPENDED":
        suspend_site(site.pk)
    if initial == "ARCHIVED":
        archive_site(site.pk)
    with pytest.raises(ValidationError):
        transition_site(site.pk, status=target)
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=site.pk).update(status=target)
    assert Site.objects.get(pk=site.pk).status == initial


def test_suspended_site_can_be_archived_without_reactivation(site):
    activate_site(site.pk)
    suspend_site(site.pk)
    assert archive_site(site.pk).status == "ARCHIVED"


def test_active_site_vetoes_owner_retirement_and_suspension_releases_veto(site, owners):
    activate_site(site.pk)
    with pytest.raises(ValidationError, match="Sites"):
        deactivate_unit(owners[1].pk)
    suspend_site(site.pk)
    deactivate_unit(owners[1].pk)
    archive_unit(owners[1].pk)
    assert Site.objects.get(pk=site.pk).organization_unit_id == owners[1].pk
    with pytest.raises(ValidationError):
        activate_site(site.pk)
    assert archive_site(site.pk).status == "ARCHIVED"


def test_new_or_reassigned_site_requires_active_owner_and_archived_owner_is_frozen(site, owners):
    deactivate_unit(owners[2].pk)
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=owners[2], code="INACTIVE_OWNER", name="Website")
    site.organization_unit = owners[2]
    with pytest.raises(ValidationError):
        site.save()
    archive_site(site.pk)
    persisted = Site.objects.get(pk=site.pk)
    persisted.organization_unit = owners[0]
    with pytest.raises(ValidationError):
        persisted.save()


def test_database_and_model_reject_destructive_delete_and_rekey(site):
    with pytest.raises(ValidationError):
        site.delete()
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=site.pk).delete()
    with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("UPDATE sites_site SET id=id+100000 WHERE id=%s", [site.pk])
    assert Site.objects.filter(pk=site.pk).exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("action", ["activate", "reassign"])
def test_site_activation_or_owner_move_and_owner_deactivation_are_serialized(owners, action):
    root, target, _ = owners
    site = Site.objects.create(organization_unit=target if action == "activate" else root, code="RACE", name="Concurrent website")
    if action == "reassign":
        activate_site(site.pk)
    barrier = Barrier(3)

    def attempt(site_write):
        close_old_connections()
        try:
            with transaction.atomic():
                with connections["default"].cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '5s'")
                    cursor.execute("SET LOCAL statement_timeout = '10s'")
                barrier.wait(timeout=10)
                if not site_write:
                    deactivate_unit(target.pk)
                elif action == "activate":
                    activate_site(site.pk)
                else:
                    value = Site.objects.get(pk=site.pk)
                    value.organization_unit_id = target.pk
                    value.save(update_fields=["organization_unit"])
            return "committed"
        except ValidationError:
            return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt, value) for value in [True, False]]
        barrier.wait(timeout=10)
        results = [future.result(timeout=20) for future in futures]
    assert sorted(results) == ["committed", "rejected"]
    site.refresh_from_db()
    target.refresh_from_db()
    assert not (site.status == "ACTIVE" and site.organization_unit_id == target.pk and target.status != "ACTIVE")
