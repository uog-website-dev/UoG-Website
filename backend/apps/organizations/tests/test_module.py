"""Foundation checks for the organizations domain boundary."""
import ast
from importlib import import_module
from pathlib import Path

import pytest
from django.apps import apps
from django.conf import settings
from django.contrib import admin
from django.core.management import call_command
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.urls import get_resolver

DOMAIN_MODULES = (
    "apps.organizations",
    "apps.organizations.apps",
    "apps.organizations.models",
    "apps.organizations.services",
    "apps.organizations.selectors",
    "apps.organizations.api",
    "apps.organizations.api.urls",
    "apps.organizations.admin",
    "apps.organizations.migrations",
)

OTHER_APPS = ("core", "api", "accounts")
FOREIGN_APP_PREFIXES = tuple(f"apps.{name}" for name in OTHER_APPS)


def _imports_app(module: str, app: str) -> bool:
    return module == app or module.startswith(f"{app}.")


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
    return imported


def test_domain_modules_import():
    for name in DOMAIN_MODULES:
        import_module(name)


def test_app_is_registered():
    config = apps.get_app_config("organizations")
    assert config.name == "apps.organizations"
    assert config.verbose_name == "Organizations"
    assert "apps.organizations" in settings.INSTALLED_APPS


def test_domain_models_and_their_admins_are_registered():
    config = apps.get_app_config("organizations")
    models = list(config.get_models())
    assert {model.__name__ for model in models} == {"OrganizationType", "OrganizationUnit"}
    assert all(model in admin.site._registry for model in models)


def test_api_namespace_is_registered():
    from apps.organizations.api.urls import app_name, urlpatterns

    assert app_name == "organizations"
    assert urlpatterns

    namespaces = set()

    def _collect(resolver):
        for pattern in resolver.url_patterns:
            if getattr(pattern, "url_patterns", None) is not None:
                if pattern.namespace:
                    namespaces.add(pattern.namespace)
                _collect(pattern)

    _collect(get_resolver())
    assert "organizations" in namespaces


def test_organizations_does_not_import_other_domains():
    root = Path(import_module("apps.organizations").__file__).resolve().parent
    offenders = []
    for path in root.rglob("*.py"):
        if "tests" in path.parts:
            continue
        for module in _imported_modules(path):
            # Reuse the platform's verified authentication/role infrastructure.
            # Organization business logic still cannot depend on other domains.
            if path.parent.name == "api" and module in {
                "apps.accounts.authentication", "apps.accounts.permissions",
            }:
                continue
            if any(_imports_app(module, app) for app in FOREIGN_APP_PREFIXES):
                offenders.append(f"{path.name} imports {module}")
    assert offenders == []


def test_other_domains_do_not_import_organizations():
    apps_root = Path(settings.BASE_DIR) / "apps"
    offenders = []
    for app_name in OTHER_APPS:
        for path in (apps_root / app_name).rglob("*.py"):
            for module in _imported_modules(path):
                if _imports_app(module, "apps.organizations"):
                    offenders.append(f"{path.relative_to(apps_root)} imports {module}")
    assert offenders == []


def test_django_check_passes():
    call_command("check")


@pytest.mark.django_db
def test_organizations_has_no_pending_migrations():
    # The lookup and its seed migrations must match the current model state.
    call_command(
        "makemigrations",
        "organizations",
        "--check",
        "--dry-run",
        verbosity=0,
    )


@pytest.mark.django_db
def test_existing_migrations_apply_and_platform_routes_remain(client):
    loader = MigrationLoader(connection, ignore_no_migrations=True)
    assert ("api", "0001_initial") in loader.disk_migrations
    assert ("accounts", "0001_initial") in loader.disk_migrations
    assert "organizations" in loader.migrated_apps
    assert ("organizations", "0001_initial") in loader.disk_migrations
    assert ("organizations", "0002_seed_organization_types") in loader.disk_migrations
    assert ("organizations", "0003_organizationunit") in loader.disk_migrations
    assert ("organizations", "0004_hierarchy_integrity") in loader.disk_migrations
    assert ("organizations", "0005_lifecycle_rules") in loader.disk_migrations
    assert ("organizations", "0006_audit_events") in loader.disk_migrations
    assert ("audit", "0002_common_writer") in loader.disk_migrations

    applied = MigrationRecorder(connection).applied_migrations()
    assert ("api", "0001_initial") in applied
    assert ("accounts", "0001_initial") in applied
    assert ("organizations", "0001_initial") in applied
    assert ("organizations", "0002_seed_organization_types") in applied
    assert ("organizations", "0003_organizationunit") in applied
    assert ("organizations", "0004_hierarchy_integrity") in applied
    assert ("organizations", "0005_lifecycle_rules") in applied
    assert ("organizations", "0006_audit_events") in applied
    assert ("audit", "0002_common_writer") in applied

    call_command("migrate", "--check", verbosity=0)

    assert client.get("/health/live").status_code == 200
    pages = client.get("/api/pages/")
    assert pages.status_code == 200
    assert pages.json()["count"] == 0

    root = client.get("/api/")
    assert root.status_code == 200
    assert "pages" in root.json()
    assert "organizations" not in root.json()

    # The reserved prefix is mounted and exposes no operation.
    assert client.get("/api/organizations/").status_code == 404
    assert client.get("/api/me/").status_code == 401
