"""One application serves representative Sites from configuration, not from code."""
import json
from pathlib import Path

import pytest
from django.conf import settings
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.test import Client

from apps.organizations.models import OrganizationUnit
from apps.sites.models import Module, Site, SiteTemplate

pytestmark = pytest.mark.django_db
BACKEND = Path(__file__).resolve().parents[1]
FOUNDATION = BACKEND / "apps" / "sites" / "fixtures" / "uog-foundation.json"
ORGANIZATIONS = BACKEND / "tests" / "fixtures" / "organizations" / "uog-structure.json"
SITES = "/api/v1/sites/"
TEMPLATES = "/api/v1/site-templates/"
MODULES = "/api/v1/modules/"
CONTEXT = "/api/v1/site-context/"
SHIPPED = ("EVENTS", "STAFF_DIRECTORY")


@pytest.fixture
def admin(client, oidc, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    client.defaults.update(oidc.header())
    return client


def test_application_code_does_not_name_institutional_hostnames():
    hits = []
    for root in (BACKEND / "apps", BACKEND / "config"):
        for path in root.rglob("*.py"):
            if "tests" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            if "uog.local" in text or "uog.edu.et" in text:
                hits.append(str(path.relative_to(BACKEND)))
    assert hits == []


def test_representative_foundation_resolves_each_site_from_data(admin):
    document = json.loads(FOUNDATION.read_text(encoding="utf-8"))
    assert document["schema_version"] == 1
    applied_before = set(MigrationRecorder(connection).applied_migrations())
    disk_before = _site_migrations()
    units = _create_organizations(admin)
    _ship_registered_modules(admin)
    templates = _templates(admin)
    sites = [_provision(admin, units, templates, entry) for entry in document["sites"]]

    by_code = {site["code"]: site for site in sites}
    assert by_code["MAIN"]["is_main"] is True
    assert by_code["INFORMATICS"]["is_main"] is False
    assert {site["organization_unit"] for site in sites} == {
        units[entry["organization_code"]]["id"] for entry in document["sites"]
    }
    displays = {site["configuration"]["identity"]["display_name"] for site in sites}
    assert displays == {
        "University of Gondar", "College of Informatics", "College of Medicine", "Research Center",
    }
    assert by_code["INFORMATICS"]["template"] == by_code["MEDICINE"]["template"]
    assert by_code["INFORMATICS"]["configuration"] != by_code["MEDICINE"]["configuration"]
    assert [site["modules"] for site in sites] == [
        ["STAFF_DIRECTORY"], ["EVENTS"], ["EVENTS", "STAFF_DIRECTORY"], [],
    ]
    assert _context(admin, "www.uog.local")["site"]["code"] == "MAIN"
    assert _context(admin, "informatics.uog.local")["modules"] == ["EVENTS"]
    assert _context(admin, "medicine.uog.local")["modules"] == ["EVENTS", "STAFF_DIRECTORY"]
    assert _context(admin, "research.uog.local")["modules"] == []

    edited = _mutate(admin, f"{TEMPLATES}{templates['COLLEGE']['id']}/", {
        "default_configuration": {
            **templates["COLLEGE"]["default_configuration"],
            "identity": {**templates["COLLEGE"]["default_configuration"]["identity"], "display_name": "Edited template"},
        },
    })
    assert edited.status_code == 200, edited.content
    assert _context(admin, "informatics.uog.local")["site"]["code"] == "INFORMATICS"
    assert Site.objects.get(code="INFORMATICS").configuration["identity"]["display_name"] == "College of Informatics"
    assert Site.objects.get(code="MEDICINE").configuration["identity"]["display_name"] == "College of Medicine"

    spoofed = admin.get(CONTEXT, HTTP_HOST="informatics.uog.local", HTTP_X_FORWARDED_HOST="medicine.uog.local")
    assert spoofed.status_code == 200 and spoofed.json()["site"]["code"] == "INFORMATICS"
    assert admin.get(CONTEXT, HTTP_HOST="unknown.uog.local").status_code == 404
    assert admin.get(CONTEXT, HTTP_HOST="localhost").json()["site"] is None
    anonymous = Client().get(CONTEXT, HTTP_HOST="medicine.uog.local")
    assert anonymous.status_code == 200 and anonymous.json()["site"]["id"] == by_code["MEDICINE"]["id"]
    assert admin.get(
        f"{SITES}{by_code['MEDICINE']['id']}/domains/{by_code['INFORMATICS']['domain_id']}/",
    ).status_code == 404
    assert admin.get(
        f"{SITES}{by_code['MEDICINE']['id']}/modules/{by_code['INFORMATICS']['module_id']}/",
    ).status_code == 404
    blocked = admin.post(
        f"{SITES}{by_code['INFORMATICS']['id']}/modules/",
        {"module": Module.objects.get(code="CMS").pk, "configuration": {}},
        content_type="application/json",
    )
    assert blocked.status_code == 400

    extra = document["added_without_redeploy"]
    created = admin.post("/api/v1/organizations/", {
        "code": extra["organization"]["code"],
        "name": extra["organization"]["name"],
        "organization_type": extra["organization"]["organization_type"],
        "parent": units[extra["organization"]["parent_code"]]["id"],
    }, content_type="application/json")
    assert created.status_code == 201, created.content
    units[extra["organization"]["code"]] = created.json()
    law = _provision(admin, units, templates, extra["site"])
    assert law["modules"] == ["EVENTS"]
    assert _site_migrations() == disk_before
    assert set(MigrationRecorder(connection).applied_migrations()) == applied_before
    assert list(settings.DATABASES) == ["default"]
    assert Site.objects.count() == 5

    suspended = _mutate(admin, f"{SITES}{by_code['MEDICINE']['id']}/suspend/", {})
    assert suspended.status_code == 200 and suspended.json()["status"] == "SUSPENDED"
    assert admin.get(CONTEXT, HTTP_HOST="medicine.uog.local").status_code == 404
    assert _context(admin, "informatics.uog.local")["site"]["code"] == "INFORMATICS"
    assert _context(admin, "law.uog.local")["site"]["code"] == "LAW"
    assert _context(admin, "www.uog.local")["modules"] == ["STAFF_DIRECTORY"]
    assert OrganizationUnit.objects.get(code="CI").organization_type.code == "COLLEGE"
    assert OrganizationUnit.objects.get(code="UOG").organization_type.code == "UNIVERSITY"
    assert admin.get("/api/v1/organizations/tree/").status_code == 200


def _create_organizations(client):
    manifest = json.loads(ORGANIZATIONS.read_text(encoding="utf-8"))
    units = {}
    for entry in manifest["units"]:
        payload = {key: value for key, value in entry.items() if key != "parent_code"}
        payload["parent"] = units[entry["parent_code"]]["id"] if entry["parent_code"] else None
        response = client.post("/api/v1/organizations/", payload, content_type="application/json")
        assert response.status_code == 201, response.content
        units[entry["code"]] = response.json()
    return units


def _ship_registered_modules(client):
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation (code) VALUES ('EVENTS'), ('STAFF_DIRECTORY')")
    for code in SHIPPED:
        listed = client.get(MODULES, {"code": code}).json()["results"][0]
        detail = client.get(f"{MODULES}{listed['id']}/")
        updated = client.patch(
            f"{MODULES}{listed['id']}/",
            {"status": "IMPLEMENTED", "is_enabled": True},
            content_type="application/json",
            HTTP_IF_MATCH=detail["ETag"],
        )
        assert updated.status_code == 200, updated.content


def _templates(client):
    listed = client.get(TEMPLATES).json()["results"]
    return {item["code"]: item for item in listed}


def _provision(client, units, templates, entry):
    created = client.post(SITES, {
        "code": entry["code"],
        "name": entry["name"],
        "organization_unit": units[entry["organization_code"]]["id"],
        "template": templates[entry["template"]]["id"],
        "is_main": entry["is_main"],
    }, content_type="application/json")
    assert created.status_code == 201, created.content
    assert created.json()["status"] == "DRAFT"
    configured = _mutate(client, created["Location"] + "configuration/", entry["configuration"])
    assert configured.status_code == 200, configured.content
    domain = client.post(created["Location"] + "domains/", {
        "hostname": entry["hostname"], "status": "ACTIVE",
    }, content_type="application/json")
    assert domain.status_code == 201, domain.content
    primary = client.post(domain["Location"] + "make-primary/", {}, content_type="application/json", HTTP_IF_MATCH=domain["ETag"])
    assert primary.status_code == 200 and primary.json()["is_primary"] is True
    assert client.get(CONTEXT, HTTP_HOST=entry["hostname"]).status_code == 404
    module_id = None
    for code in entry["modules"]:
        enabled = client.post(created["Location"] + "modules/", {
            "module": Module.objects.get(code=code).pk, "configuration": {},
        }, content_type="application/json")
        assert enabled.status_code == 201, enabled.content
        module_id = enabled.json()["id"]
    activated = _mutate(client, created["Location"] + "activate/", {})
    assert activated.status_code == 200 and activated.json()["status"] == "ACTIVE"
    context = _context(client, entry["hostname"])
    assert context["site"]["code"] == entry["code"]
    assert context["domain"] == entry["hostname"]
    assert context["modules"] == sorted(entry["modules"])
    assert context["site"]["organization_unit"] == units[entry["organization_code"]]["id"]
    body = activated.json()
    body["modules"] = context["modules"]
    body["domain_id"] = domain.json()["id"]
    body["module_id"] = module_id
    return body


def _context(client, hostname):
    response = client.get(CONTEXT, HTTP_HOST=hostname)
    assert response.status_code == 200, response.content
    return response.json()


def _mutate(client, url, payload):
    etag = client.get(url.split("activate/")[0].split("suspend/")[0].split("configuration/")[0])["ETag"]
    method = client.post if url.rstrip("/").split("/")[-1] in {"activate", "suspend", "archive"} else client.patch
    return method(url, payload, content_type="application/json", HTTP_IF_MATCH=etag)


def _site_migrations():
    loader = MigrationLoader(connection, ignore_no_migrations=True)
    return tuple(sorted(name for app, name in loader.disk_migrations if app == "sites"))
