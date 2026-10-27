"""Hostname resolution is dynamic, fail-closed, and not authorization."""
import json
from pathlib import Path

import pytest
from django.contrib.sessions.middleware import SessionMiddleware
from django.core.cache import cache, caches
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.http import HttpResponse
from django.test import RequestFactory

from apps.core.cache import bind_cache_site, make_cache_key, reset_cache_site
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.middleware import SiteResolutionMiddleware
from apps.sites.models import Site, SiteDomain
from apps.sites.services.configuration import apply_site_configuration
from apps.sites.services.domains import deactivate_domain
from apps.sites.services.lifecycle import activate_site, archive_site, suspend_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def sites():
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    medicine = OrganizationUnit.objects.create(code="CM", name="College of Medicine", organization_type=college, parent=root)
    first = Site.objects.create(organization_unit=informatics, code="INFORMATICS", name="Informatics")
    second = Site.objects.create(organization_unit=medicine, code="MEDICINE", name="Medicine")
    activate_site(first.pk)
    activate_site(second.pk)
    SiteDomain.objects.create(site=first, hostname="informatics.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=first, hostname="ci.uog.edu.et", status="ACTIVE")
    SiteDomain.objects.create(site=first, hostname="computing.uog.edu.et", redirect_to_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=second, hostname="medicine.uog.edu.et", is_primary=True, status="ACTIVE")
    return first, second


def _site_migrations():
    loader = MigrationLoader(connection, ignore_no_migrations=True)
    return tuple(sorted(name for app, name in loader.disk_migrations if app == "sites"))


def _call(host, path="/api/v1/organizations/", forwarded=None, secure=False):
    request = RequestFactory().get(path, HTTP_HOST=host, secure=secure)
    if forwarded:
        request.META["HTTP_X_FORWARDED_HOST"] = forwarded
    seen = {}

    def inner(resolved):
        seen["site"] = resolved.site
        return HttpResponse("ok")

    response = SiteResolutionMiddleware(inner)(request)
    return response, seen.get("site")


def test_primary_alias_and_a_second_site_resolve_without_hardcoded_hosts(sites):
    primary, site = _call("INFORMATICS.UOG.EDU.ET")
    plain_alias, plain_site = _call("ci.uog.edu.et")
    alias, alias_site = _call("computing.uog.edu.et:80")
    other, other_site = _call("medicine.uog.edu.et")
    source = Path(SiteResolutionMiddleware.__call__.__code__.co_filename).read_text(encoding="utf-8")
    assert "uog.edu.et" not in source
    assert primary.status_code == 200 and site == sites[0]
    assert plain_alias.status_code == 200 and plain_site == sites[0]
    assert alias.status_code == 302 and alias["Location"] == "http://informatics.uog.edu.et/api/v1/organizations/"
    assert "evil" not in alias["Location"]
    assert other.status_code == 200 and other_site == sites[1]
    assert site.pk != other_site.pk


def test_forwarded_host_unknown_and_disabled_domains_fail_closed(sites, client):
    response, site = _call("informatics.uog.edu.et", forwarded="medicine.uog.edu.et")
    assert response.status_code == 200 and site == sites[0]
    invalid, _ = _call("not a host")
    assert invalid.status_code == 404
    missing, _ = _call("unknown.uog.edu.et")
    assert missing.status_code == 404 and json.loads(missing.content)["error"]["code"] == "not_found"
    medicine = SiteDomain.objects.get(hostname="medicine.uog.edu.et")
    spare = SiteDomain.objects.create(site=medicine.site, hostname="med.uog.edu.et", status="ACTIVE")
    deactivate_domain(medicine.pk, replacement_id=spare.pk)
    disabled, _ = _call("medicine.uog.edu.et")
    assert disabled.status_code == 404
    assert client.get("/api/v1/organizations/", HTTP_HOST="informatics.uog.edu.et").status_code == 401


@pytest.mark.parametrize("change", ["suspend", "archive"])
def test_suspended_and_archived_sites_do_not_resolve(sites, change):
    if change == "suspend":
        suspend_site(sites[1].pk)
    else:
        archive_site(sites[1].pk)
    response, site = _call("medicine.uog.edu.et")
    assert response.status_code == 404 and site is None


def test_platform_host_has_no_site_and_cache_and_cookies_stay_separated(client, settings):
    response, site = _call("localhost", path="/health/live")
    assert response.status_code == 200 and site is None
    assert "Host" in response["Vary"]
    first = bind_cache_site(11)
    try:
        left = make_cache_key("pages", "uog")
    finally:
        reset_cache_site(first)
    second = bind_cache_site(22)
    try:
        right = make_cache_key("pages", "uog")
    finally:
        reset_cache_site(second)
    assert left == "uog:site:11:pages" and right == "uog:site:22:pages" and left != right
    assert settings.SESSION_COOKIE_DOMAIN is None and settings.CSRF_COOKIE_DOMAIN is None
    assert settings.USE_X_FORWARDED_HOST is False

    def inner(request):
        request.session["seen"] = "1"
        return HttpResponse("ok")

    stacked = SiteResolutionMiddleware(SessionMiddleware(inner))
    cookie = stacked(RequestFactory().get("/health/live", HTTP_HOST="localhost")).cookies["sessionid"]
    assert cookie["domain"] == ""
    assert client.get("/health/live").status_code == 200


def test_alias_redirect_keeps_path_and_query_and_rejects_open_redirects(sites):
    kept, _ = _call("computing.uog.edu.et", path="/news/events?lang=en&page=2")
    assert kept.status_code == 302
    assert kept["Location"] == "http://informatics.uog.edu.et/news/events?lang=en&page=2"
    secure, _ = _call("computing.uog.edu.et", path="/news?ref=https://evil.example", secure=True)
    assert secure["Location"] == "https://informatics.uog.edu.et/news?ref=https://evil.example"

    injected = RequestFactory().get("/news", HTTP_HOST="computing.uog.edu.et")
    injected.META["QUERY_STRING"] = "next=1\r\nLocation: http://evil.example"
    blocked = SiteResolutionMiddleware(lambda request: HttpResponse("ok"))(injected)
    assert blocked.status_code == 404 and "Location" not in blocked

    relative = RequestFactory().get("/news", HTTP_HOST="computing.uog.edu.et")
    relative.path = "//evil.example"
    hijacked = SiteResolutionMiddleware(lambda request: HttpResponse("ok"))(relative)
    assert hijacked.status_code == 404 and "Location" not in hijacked


def test_configured_institutional_hosts_resolve_only_their_own_site(client):
    migrations = _site_migrations()
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics_unit = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    main = Site.objects.create(organization_unit=root, code="MAIN", name="Main Site", is_main=True)
    informatics = Site.objects.create(organization_unit=informatics_unit, code="INFORMATICS", name="Informatics Site")
    apply_site_configuration(main.pk, {"identity": {"display_name": "University of Gondar"}, "presentation": {"theme": "institutional"}})
    apply_site_configuration(informatics.pk, {"identity": {"display_name": "College of Informatics"}, "presentation": {"theme": "high-contrast"}})
    activate_site(main.pk)
    activate_site(informatics.pk)
    SiteDomain.objects.create(site=main, hostname="uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=informatics, hostname="informatics.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=informatics, hostname="www.informatics.uog.edu.et", redirect_to_primary=True, status="ACTIVE")
    source = Path(SiteResolutionMiddleware.__call__.__code__.co_filename).read_text(encoding="utf-8")
    assert "uog.edu.et" not in source

    root_context = client.get("/api/v1/site-context/", HTTP_HOST="uog.edu.et")
    college_context = client.get(
        "/api/v1/site-context/",
        HTTP_HOST="informatics.uog.edu.et",
        HTTP_X_FORWARDED_HOST="uog.edu.et",
        HTTP_FORWARDED="host=medicine.uog.edu.et",
    )
    assert root_context.status_code == 200
    assert root_context.json()["site"]["code"] == "MAIN"
    assert root_context.json()["configuration"] == {"display_name": "University of Gondar", "theme": "institutional"}
    assert college_context.status_code == 200
    assert college_context.json()["site"]["code"] == "INFORMATICS"
    assert college_context.json()["domain"] == "informatics.uog.edu.et"
    assert college_context.json()["configuration"]["display_name"] == "College of Informatics"
    assert root_context.json()["configuration"] != college_context.json()["configuration"]
    spoofed = client.get("/api/v1/site-context/", HTTP_HOST="localhost", HTTP_X_FORWARDED_HOST="uog.edu.et")
    assert spoofed.status_code == 200 and spoofed.json()["site"] is None
    alias = client.get("/news?lang=en", HTTP_HOST="www.informatics.uog.edu.et")
    assert alias.status_code == 302
    assert alias["Location"] == "http://informatics.uog.edu.et/news?lang=en"

    unknown = client.get("/api/v1/site-context/", HTTP_HOST="unknown.uog.edu.et")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "not_found"
    assert b"University of Gondar" not in unknown.content

    keys = {}

    def remember(request):
        cache.set("visitor", request.site.code, 30)
        keys[request.site.code] = caches["default"].make_key("visitor")
        return HttpResponse(request.site.code)

    SiteResolutionMiddleware(remember)(RequestFactory().get("/", HTTP_HOST="uog.edu.et"))
    SiteResolutionMiddleware(remember)(RequestFactory().get("/", HTTP_HOST="informatics.uog.edu.et"))
    assert keys["MAIN"] != keys["INFORMATICS"]
    assert f"site:{main.pk}:" in keys["MAIN"]
    assert f"site:{informatics.pk}:" in keys["INFORMATICS"]
    assert cache.get("visitor") is None
    for site, code in ((main, "MAIN"), (informatics, "INFORMATICS")):
        token = bind_cache_site(site.pk)
        assert cache.get("visitor") == code
        cache.delete("visitor")
        reset_cache_site(token)

    SiteDomain.objects.create(site=main, hostname="www.uog.edu.et", status="ACTIVE")
    added = client.get("/api/v1/site-context/", HTTP_HOST="www.uog.edu.et")
    assert added.status_code == 200 and added.json()["site"]["code"] == "MAIN"
    assert _site_migrations() == migrations

    retired = SiteDomain.objects.get(hostname="www.informatics.uog.edu.et")
    deactivate_domain(retired.pk)
    assert client.get("/api/v1/site-context/", HTTP_HOST="www.informatics.uog.edu.et").status_code == 404
    suspend_site(informatics.pk)
    assert client.get("/api/v1/site-context/", HTTP_HOST="informatics.uog.edu.et").status_code == 404
    assert client.get("/api/v1/site-context/", HTTP_HOST="uog.edu.et").json()["site"]["code"] == "MAIN"
