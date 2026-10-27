"""Site administration API: restricted writes, isolation and standard errors."""
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import connection

from apps.audit.models import AuditEvent
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain, SiteModule

pytestmark = pytest.mark.django_db
SITES = "/api/v1/sites/"
TEMPLATES = "/api/v1/site-templates/"
MODULES = "/api/v1/modules/"


@pytest.fixture
def owner():
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    return OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)


@pytest.fixture
def admin(client, oidc, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    client.defaults.update(oidc.header())
    return client


def _etag(response):
    return response["ETag"]


@pytest.mark.parametrize("method,path", [
    ("get", SITES), ("post", SITES), ("post", SITES + "1/domains/"), ("get", TEMPLATES), ("post", MODULES), ("get", MODULES),
])
def test_anonymous_and_non_admin_are_rejected(client, oidc, method, path):
    anonymous = getattr(client, method)(path, content_type="application/json")
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "not_authenticated"
    denied = getattr(client, method)(path, content_type="application/json", **oidc.header(realm_access={"roles": ["platform-viewer"]}))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "permission_denied"


@pytest.mark.parametrize("debug,opt_in", [(False, False), (False, True), (True, False)])
def test_writes_stay_closed_without_the_development_gate(admin, settings, owner, debug, opt_in):
    settings.DEBUG = debug
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = opt_in
    assert admin.get(SITES).status_code == 200
    assert admin.post(SITES, {"name": "Website"}, content_type="application/json").status_code == 403


def test_site_lifecycle_configuration_domains_and_cross_site_ids(admin, owner):
    created = admin.post(SITES, {
        "code": " informatics ", "name": "Informatics", "organization_unit": owner.pk, "short_name": "CoI",
    }, content_type="application/json")
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["code"] == "INFORMATICS" and body["status"] == "DRAFT"
    assert created["Location"].endswith(f"/api/v1/sites/{body['id']}/")
    assert admin.post(SITES, {"code": "INFORMATICS", "name": "Again", "organization_unit": owner.pk}, content_type="application/json").status_code == 409
    detail = admin.get(created["Location"])
    assert detail.status_code == 200 and detail["ETag"]
    missing = admin.patch(created["Location"], {"name": "Changed"}, content_type="application/json")
    assert missing.status_code == 428
    stale = admin.patch(created["Location"], {"name": "Changed"}, content_type="application/json", HTTP_IF_MATCH='"nope"')
    assert stale.status_code == 412
    renamed = admin.patch(created["Location"], {"name": "Informatics Website"}, content_type="application/json", HTTP_IF_MATCH=_etag(detail))
    assert renamed.status_code == 200 and renamed.json()["name"] == "Informatics Website"
    activated = admin.post(created["Location"] + "activate/", {}, content_type="application/json", HTTP_IF_MATCH=_etag(renamed))
    assert activated.status_code == 200 and activated.json()["status"] == "ACTIVE"
    configured = admin.patch(created["Location"] + "configuration/", {"identity": {"display_name": "Informatics"}}, content_type="application/json", HTTP_IF_MATCH=_etag(activated))
    assert configured.status_code == 200
    assert configured.json()["configuration"]["identity"]["display_name"] == "Informatics"

    other = admin.post(SITES, {"code": "MEDICINE", "name": "Medicine", "organization_unit": owner.pk}, content_type="application/json")
    primary = admin.post(created["Location"] + "domains/", {"hostname": "INFORMATICS.UOG.EDU.ET", "status": "ACTIVE"}, content_type="application/json")
    alias = admin.post(created["Location"] + "domains/", {"hostname": "computing.uog.edu.et", "status": "ACTIVE"}, content_type="application/json")
    assert primary.status_code == 201 and primary.json()["hostname"] == "informatics.uog.edu.et"
    assert alias.status_code == 201
    assert admin.get(other["Location"] + f"domains/{primary.json()['id']}/").status_code == 404
    promoted = admin.post(alias["Location"] + "set-primary/", {}, content_type="application/json", HTTP_IF_MATCH=_etag(alias))
    assert promoted.status_code == 200 and promoted.json()["is_primary"] is True
    assert SiteDomain.objects.filter(site_id=body["id"], is_primary=True).count() == 1
    assert admin.get(SITES + "?status=ACTIVE&search=info").json()["count"] == 1
    assert admin.get(SITES + "?unknown=1").status_code == 400


def test_templates_modules_and_independent_site_enablement(admin, owner):
    templates = admin.get(TEMPLATES + "?code=COLLEGE")
    assert templates.status_code == 200 and templates.json()["results"][0]["code"] == "COLLEGE"
    inactive = admin.post(TEMPLATES, {"code": "draft_tpl", "name": "Draft", "description": "Not ready."}, content_type="application/json")
    assert inactive.status_code == 201 and inactive.json()["status"] == "INACTIVE"
    rejected = admin.post(SITES, {
        "code": "PORTAL", "name": "Portal", "organization_unit": owner.pk, "template": inactive.json()["id"],
    }, content_type="application/json")
    assert rejected.status_code == 400
    college = admin.get(TEMPLATES + "?code=COLLEGE").json()["results"][0]
    from_template = admin.post(SITES, {
        "code": "PORTAL", "name": "Portal", "organization_unit": owner.pk, "template": college["id"],
    }, content_type="application/json")
    assert from_template.status_code == 201 and from_template.json()["template"] == college["id"]

    events = Module.objects.get(code="EVENTS")
    assert admin.get(MODULES + "?status=PLANNED&code=EVENTS").json()["results"][0]["is_enabled"] is False
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation (code) VALUES ('EVENTS')")
    detail = admin.get(MODULES + f"{events.pk}/")
    enabled = admin.patch(detail["Location"] if "Location" in detail else MODULES + f"{events.pk}/", {
        "status": "IMPLEMENTED", "is_enabled": True,
    }, content_type="application/json", HTTP_IF_MATCH=_etag(detail))
    assert enabled.status_code == 200, enabled.content
    site = Site.objects.get(code="PORTAL")
    other = admin.post(SITES, {"code": "LAW", "name": "Law", "organization_unit": owner.pk}, content_type="application/json").json()
    first = admin.post(f"{SITES}{site.pk}/modules/", {"module": events.pk, "configuration": {}}, content_type="application/json")
    assert first.status_code == 201, first.content
    assert admin.post(f"{SITES}{site.pk}/modules/", {"module": events.pk, "configuration": {}}, content_type="application/json").status_code == 409
    assert admin.get(f"{SITES}{other['id']}/modules/{first.json()['id']}/").status_code == 404
    turned_off = admin.post(first["Location"] + "disable/", {}, content_type="application/json", HTTP_IF_MATCH=_etag(first))
    assert turned_off.status_code == 200 and turned_off.json()["is_enabled"] is False
    assert SiteModule.objects.get(pk=first.json()["id"]).configuration == {}
    assert admin.get(f"{SITES}{other['id']}/modules/").json()["count"] == 0
    cms = Module.objects.get(code="CMS")
    blocked = admin.post(f"{SITES}{site.pk}/modules/", {"module": cms.pk, "configuration": {}}, content_type="application/json")
    assert blocked.status_code == 400


def test_domain_api_audits_primary_switch_and_blocks_primary_deactivation(admin, owner):
    request_id = str(uuid4())
    site = admin.post(SITES, {
        "code": "PORTAL", "name": "Portal", "organization_unit": owner.pk,
    }, content_type="application/json", HTTP_X_REQUEST_ID=request_id, REMOTE_ADDR="198.51.100.20")
    assert site.status_code == 201, site.content
    base = site["Location"] + "domains/"
    primary = admin.post(base, {"hostname": "portal.uog.local", "status": "ACTIVE"}, content_type="application/json", HTTP_X_REQUEST_ID=request_id, REMOTE_ADDR="198.51.100.20")
    alias = admin.post(base, {"hostname": "PORTAL.UOG.LOCAL", "status": "ACTIVE"}, content_type="application/json")
    assert primary.status_code == 201, primary.content
    assert alias.status_code == 409 and alias.json()["error"]["code"] == "conflict"
    alias = admin.post(base, {"hostname": "www.portal.uog.local", "status": "ACTIVE"}, content_type="application/json")
    assert alias.status_code == 201, alias.content
    listed = admin.get(base)
    assert listed.status_code == 200 and listed.json()["count"] == 2
    chosen = admin.post(primary["Location"] + "set-primary/", {}, content_type="application/json", HTTP_IF_MATCH=_etag(primary), HTTP_X_REQUEST_ID=request_id)
    assert chosen.status_code == 200 and chosen.json()["is_primary"] is True
    refused = admin.post(primary["Location"] + "deactivate/", {}, content_type="application/json", HTTP_IF_MATCH=_etag(chosen))
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "validation_error"
    assert admin.get(primary["Location"]).json()["status"] == "ACTIVE"
    foreign = admin.post(SITES, {"code": "OTHER", "name": "Other", "organization_unit": owner.pk}, content_type="application/json")
    foreign_domain = admin.post(foreign["Location"] + "domains/", {"hostname": "other.uog.local", "status": "ACTIVE"}, content_type="application/json")
    cross = admin.post(primary["Location"] + "deactivate/", {"replacement": foreign_domain.json()["id"]}, content_type="application/json", HTTP_IF_MATCH=_etag(chosen))
    assert cross.status_code == 400
    turned_off = admin.post(
        primary["Location"] + "deactivate/", {"replacement": alias.json()["id"]},
        content_type="application/json", HTTP_IF_MATCH=_etag(chosen), HTTP_X_REQUEST_ID=request_id,
    )
    assert turned_off.status_code == 200, turned_off.content
    assert turned_off.json()["status"] == "INACTIVE" and turned_off.json()["is_primary"] is False
    assert admin.get(alias["Location"]).json()["is_primary"] is True
    assert admin.get(foreign["Location"] + f"domains/{primary.json()['id']}/").status_code == 404
    records = list(AuditEvent.objects.filter(entity_type="sites.sitedomain", entity_id=str(primary.json()["id"])).order_by("pk"))
    assert [record.action for record in records] == [
        "SITE_DOMAIN_CREATED", "SITE_DOMAIN_PRIMARY_CHANGED", "SITE_DOMAIN_PRIMARY_CHANGED", "SITE_DOMAIN_DEACTIVATED",
    ]
    assert records[0].actor_kind == "USER"
    assert records[0].actor_id == str(get_user_model().objects.get(username="devuser").pk)
    assert str(records[0].request_id) == request_id
    assert records[0].ip == "198.51.100.20"
    assert records[-1].after["status"] == "INACTIVE"
