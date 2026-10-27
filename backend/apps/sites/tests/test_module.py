"""Site startup, separation, reserved routing and existing migration compatibility."""
import ast
from importlib import import_module
from pathlib import Path

import pytest
from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.urls import get_resolver


def test_site_packages_import_and_application_loads():
    for suffix in ["", ".apps", ".models", ".services", ".selectors", ".api", ".api.urls", ".admin", ".migrations", ".tests"]:
        import_module("apps.sites" + suffix)
    config = apps.get_app_config("sites")
    assert config.name == "apps.sites"
    assert config.verbose_name == "Digital Sites"
    assert config.default_auto_field == "django.db.models.BigAutoField"
    assert "apps.sites" in settings.INSTALLED_APPS
    assert "django.contrib.sites" not in settings.INSTALLED_APPS


def test_site_domain_does_not_duplicate_organization_or_invent_future_entities():
    assert {model.__name__ for model in apps.get_app_config("sites").get_models()} == {"Module", "Site", "SiteDomain", "SiteModule", "SiteTemplate"}
    assert {model.__name__ for model in apps.get_app_config("organizations").get_models()} == {
        "OrganizationType", "OrganizationUnit",
    }


def imported_modules(path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def test_domain_foundations_do_not_import_each_other():
    apps_root = Path(settings.BASE_DIR) / "apps"
    for domain, forbidden in [("sites", "apps.organizations"), ("organizations", "apps.sites")]:
        for path in (apps_root / domain).rglob("*.py"):
            if "tests" in path.parts:
                continue
            assert not any(
                (module == forbidden or module.startswith(forbidden + "."))
                and not (domain == "sites" and module == "apps.organizations.hierarchy_lock")
                for module in imported_modules(path)
            ), path


def test_site_namespace_requires_authentication(client):
    from apps.sites.api.urls import app_name, urlpatterns

    assert app_name == "sites"
    assert urlpatterns
    assert "sites" in get_resolver().namespace_dict
    assert client.get("/api/v1/sites/").status_code == 401
    assert client.post("/api/v1/sites/", {}, content_type="application/json").status_code == 401


def test_django_system_checks_pass():
    call_command("check")


@pytest.mark.django_db
def test_site_migrations_and_real_organization_hook_are_integrated():
    loader = MigrationLoader(connection)
    assert import_module("apps.sites.migrations").__path__
    assert ("sites", "0001_initial") in loader.disk_migrations
    assert ("sites", "0002_site_configuration") in loader.disk_migrations
    assert ("sites", "0003_sitedomain") in loader.disk_migrations
    assert ("sites", "0004_sitetemplate") in loader.disk_migrations
    assert ("sites", "0005_module_registry") in loader.disk_migrations
    assert ("sites", "0006_sitemodule_settings") in loader.disk_migrations
    assert ("sites", "0007_sitedomain_audit") in loader.disk_migrations
    applied = MigrationRecorder(connection).applied_migrations()
    assert ("organizations", "0006_audit_events") in applied
    assert ("audit", "0002_common_writer") in applied
    assert ("sites", "0001_initial") in applied
    assert ("sites", "0002_site_configuration") in applied
    assert ("sites", "0003_sitedomain") in applied
    assert ("sites", "0004_sitetemplate") in applied
    assert ("sites", "0005_module_registry") in applied
    assert ("sites", "0006_sitemodule_settings") in applied
    assert ("sites", "0007_sitedomain_audit") in applied
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('sites_site'), organizations_has_active_sites(ARRAY[]::bigint[])")
        assert cursor.fetchone() == ("sites_site", False)
    call_command("migrate", "--check", verbosity=0)
    call_command("makemigrations", "sites", "--check", "--dry-run", verbosity=0)


@pytest.mark.django_db
def test_platform_routes_and_restricted_organization_boundary_remain(client):
    assert client.get("/health/live").status_code == 200
    assert client.get("/api/v1/organizations/").status_code == 401
