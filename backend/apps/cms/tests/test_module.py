"""The cms app loads, routes nothing, migrates repeatably and seeds planned codes."""
import importlib
from pathlib import Path

import pytest
from django.apps import apps as django_apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.db.migrations.loader import MigrationLoader
from django.urls import get_resolver

from apps.cms.models import SiteContent
from apps.sites.models import Module, SiteModule
from apps.sites.module_schema import empty_module_schema
from apps.sites.selectors.modules import capability_is_shipped, usable_modules
from apps.sites.services.modules import enable_module_for_site

CONTENT_CODES = {"PAGES", "POSTS", "MENUS"}


def test_cms_packages_import_and_application_loads():
    for suffix in ("", ".apps", ".models", ".api", ".api.serializers", ".migrations", ".tests"):
        importlib.import_module(f"apps.cms{suffix}")
    config = django_apps.get_app_config("cms")
    assert config.name == "apps.cms"
    assert "apps.cms" in settings.INSTALLED_APPS
    assert {model.__name__ for model in config.get_models()} == {"SiteContent"}


def test_cms_publishes_no_content_endpoints():
    # Shared content primitives are deliberately not a generic, unrestricted
    # content API: the cms app registers no namespace, views or urls module.
    assert "cms" not in get_resolver().namespace_dict
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("apps.cms.api.urls")
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("apps.cms.api.views")


def test_django_check_passes():
    call_command("check")


@pytest.mark.django_db
def test_cms_migrations_are_repeatable_and_applied():
    call_command("makemigrations", "cms", "--check", "--dry-run", verbosity=0)
    call_command("migrate", "--check", verbosity=0)
    loader = MigrationLoader(connection, ignore_no_migrations=True)
    assert ("cms", "0001_initial") in loader.disk_migrations
    assert ("cms", "0001_initial") in loader.applied_migrations
    migration = loader.disk_migrations[("cms", "0001_initial")]
    # The content table must exist only after the Site table it depends on.
    assert ("sites", "0007_sitedomain_audit") in migration.dependencies


@pytest.mark.django_db
def test_content_codes_are_registered_but_never_activated():
    assert CONTENT_CODES <= set(Module.objects.values_list("code", flat=True))
    for code in CONTENT_CODES:
        module = Module.objects.get(code=code)
        assert module.status == "PLANNED"
        assert module.is_enabled is False
        assert module.configuration_schema == empty_module_schema()
        assert not capability_is_shipped(code)
        module.status = "IMPLEMENTED"
        with pytest.raises(ValidationError):
            module.save()
    assert not usable_modules().exists()


@pytest.mark.django_db
def test_registry_database_gates_activation():
    pages = Module.objects.get(code="PAGES")
    with pytest.raises(IntegrityError), transaction.atomic():
        Module.objects.filter(pk=pages.pk).update(status="IMPLEMENTED")
    with pytest.raises(IntegrityError), transaction.atomic():
        Module.objects.filter(pk=pages.pk).update(is_enabled=True)
    pages.refresh_from_db()
    assert pages.status == "PLANNED" and pages.is_enabled is False


@pytest.mark.django_db
def test_a_site_cannot_enable_a_planned_content_code(sites):
    site, _ = sites
    for code in CONTENT_CODES:
        module = Module.objects.get(code=code)
        with pytest.raises(ValidationError):
            enable_module_for_site(site.pk, module.pk)
        with pytest.raises(IntegrityError), transaction.atomic():
            SiteModule.objects.bulk_create([SiteModule(site=site, module=module)])
    assert not SiteModule.objects.exists()


def test_documented_strategy_matches_the_migration():
    doc = Path(settings.BASE_DIR).parent / "docs" / "architecture" / "cms-content-data-model.md"
    if not doc.exists():
        pytest.skip("The runtime image ships code only; docs live in the checkout.")
    text = doc.read_text(encoding="utf-8")
    for index in SiteContent._meta.indexes:
        assert index.name in text, f"{index.name} is undocumented"
        # Every index leads with site so no plan can scan across tenants.
        assert index.fields[0] == "site"
    assert "no per-Site database or schema" in " ".join(text.split())
