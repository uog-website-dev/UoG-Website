"""Header settings: RBAC, Site isolation, module gates and typed validation."""
import pytest
from django.db import IntegrityError, transaction

from apps.sites.models import Site, SiteHeader
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable(site, *codes):
    from django.db import connection
    from apps.sites.models import Module
    from apps.sites.services.modules import enable_module_for_site

    with connection.cursor() as cursor:
        for code in codes:
            cursor.execute(
                "INSERT INTO sites_module_implementation (code) VALUES (%s) "
                "ON CONFLICT (code) DO NOTHING", [code],
            )
    for code in codes:
        enable_module_for_site(site.pk, Module.objects.get(code=code).pk)


def test_header_settings_are_scoped_validated_and_preconditioned(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="HEADER-A", name="Site A", organization_unit=owner)
    b = Site.objects.create(code="HEADER-B", name="Site B", organization_unit=owner)
    _enable(a, "MENUS", "PAGES")
    _enable(b, "MENUS", "PAGES")
    actor = _site_admin_client(client, oidc, a)
    url = f"/api/v1/sites/{a.pk}/header/"

    initial = client.get(url)
    assert initial.status_code == 200, initial.content
    body = initial.json()
    assert body["settings"] == {
        "brand_href": "/", "search_enabled": True, "sticky": False,
        "cta_label": "", "cta_url": "", "language_switcher": False,
    }
    assert body["menus"] == {"header": [], "utility": []}
    assert body["menu_state"]["header"]["published"] is None
    assert "PAGES" in body["modules"] and "MENUS" in body["modules"]
    assert not SiteHeader.objects.exists()

    payload = {
        "brand_href": "/about", "search_enabled": False, "sticky": True,
        "cta_label": "Apply now", "cta_url": "/apply",
    }
    saved = client.patch(url, payload, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert saved.status_code == 200, saved.content
    assert saved.json()["version"] == 1
    assert saved.json()["settings"]["cta_label"] == "Apply now"
    reopened = client.get(url)
    assert reopened.json()["settings"]["sticky"] is True
    assert not SiteHeader.objects.filter(site=b).exists()

    stale = client.patch(url, {"brand_href": "/lost"}, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert stale.status_code == 412
    missing = client.patch(url, {"brand_href": "/lost"}, content_type="application/json")
    assert missing.status_code == 428

    etag = reopened["ETag"]
    for invalid in (
        {"brand_href": "javascript:alert(1)"},
        {"brand_href": ""},
        {"brand_href": "/Bad Path"},
        {"brand_href": "//evil.example"},
        {"cta_url": "javascript:alert(1)", "cta_label": "Go"},
        {"cta_url": "/apply", "cta_label": ""},
        {"cta_label": "Apply now", "cta_url": ""},
        {"search_enabled": "maybe"},
        {"site": b.pk},
        {"version": 99},
        {"cta_url": "https://user:secret@example.org", "cta_label": "Go"},
    ):
        response = client.patch(url, invalid, content_type="application/json", HTTP_IF_MATCH=etag)
        assert response.status_code == 400, (invalid, response.content)

    row = SiteHeader.objects.get(site=a)
    assert row.cta_label == "Apply now" and row.updated_by == actor
    from apps.audit.models import AuditEvent
    event = AuditEvent.objects.get(action="SITE_HEADER_CREATED", entity_id=str(a.pk))
    assert event.actor_id == str(actor.pk)

    with pytest.raises(IntegrityError), transaction.atomic():
        SiteHeader.objects.filter(site=a).update(site=b)

    # A Site outside this administrator's scope stays unreadable and unwritable.
    assert client.get(f"/api/v1/sites/{b.pk}/header/").status_code == 403

    client.defaults.clear()
    assert client.get(url).status_code in (401, 403)


def test_header_requires_sites_update_and_an_enabled_module(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="HEADER-GATE", name="Gate", organization_unit=owner)
    url = f"/api/v1/sites/{site.pk}/header/"

    # Signed in without a Site role grant: no sites.update anywhere.
    assert client.get("/api/me/").status_code in (401, 403)
    client.defaults.update(oidc.header(sub="header-viewer", preferred_username="header-viewer",
                                       email="header-viewer@uog.et", realm_access={"roles": ["platform-viewer"]}))
    assert client.get("/api/me/").status_code == 200
    assert client.get(url).status_code == 403

    # A Site administrator still needs MENUS or PAGES enabled on this Site.
    _site_admin_client(client, oidc, site)
    assert client.get(url).status_code == 403
    _enable(site, "PAGES")
    allowed = client.get(url)
    assert allowed.status_code == 200, allowed.content
    assert client.patch(url, {"sticky": True}, content_type="application/json", HTTP_IF_MATCH=allowed["ETag"]).status_code == 200


def test_public_header_is_hostname_scoped(client, owner, settings):
    from apps.sites.models import SiteDomain
    from apps.sites.services.lifecycle import activate_site

    a = Site.objects.create(code="HEADER-PUB-A", name="Public A", organization_unit=owner)
    b = Site.objects.create(code="HEADER-PUB-B", name="Public B", organization_unit=owner)
    for site, host in ((a, "header-a.uog.edu.et"), (b, "header-b.uog.edu.et")):
        activate_site(site.pk)
        SiteDomain.objects.create(site=site, hostname=host, is_primary=True, status="ACTIVE")
    from apps.sites.header import header_values
    row = SiteHeader.objects.create(site=a, sticky=True, cta_label="Apply now", cta_url="https://example.org/apply")
    row.published_settings = header_values(row)
    row.save(update_fields=["published_settings"])
    settings.ALLOWED_HOSTS = ["*"]
    first = client.get("/api/v1/site-context/", HTTP_HOST="header-a.uog.edu.et")
    second = client.get("/api/v1/site-context/", HTTP_HOST="header-b.uog.edu.et")
    assert first.status_code == second.status_code == 200
    assert first.json()["configuration"]["header"]["sticky"] is True
    assert first.json()["configuration"]["header"]["cta_url"] == "https://example.org/apply"
    assert first.json()["configuration"]["languages"] == ["en-us"]
    assert second.json()["configuration"]["header"]["sticky"] is False
    assert "no-store" in first["Cache-Control"]
