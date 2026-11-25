"""Draft/publish, lint, audit and isolation for Site footer/header chrome."""
import pytest

from apps.audit.models import AuditEvent
from apps.cms.menu_models import Menu
from apps.sites.api.footer import public_footer
from apps.sites.api.header import public_header
from apps.sites.chrome_lint import lint_footer, lint_page
from apps.sites.footer import apply_footer_column_copy
from apps.sites.header import header_has_unpublished_changes, header_values
from apps.sites.models import Site, SiteFooter, SiteHeader
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _site(owner, code, name="Chrome"):
    return Site.objects.create(code=code, name=name, organization_unit=owner)


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


def _admin(client, oidc, site):
    return _site_admin_client(client, oidc, site)


def test_footer_draft_publish_restore_and_audit(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-FOOTER")
    _enable(site, "MENUS")
    actor = _admin(client, oidc, site)
    menu = Menu.objects.create(site=site, location="footer", name="Main review mainqa-8995d437 University resources")
    second = Menu.objects.create(site=site, name="Internal university")
    url = f"/api/v1/sites/{site.pk}/footer/"
    initial = client.get(url)
    assert initial.status_code == 200 and not SiteFooter.objects.exists()
    saved = client.patch(url, {
        "description": "Reviewed public footer",
        "columns": [
            {"menu": str(menu.pk), "heading": "University", "description": "Our institution"},
            {"menu": str(second.pk), "heading": "Explore", "description": ""},
        ],
    }, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert saved.status_code == 200, saved.content
    body = saved.json()
    assert body["has_unpublished_changes"] is True
    assert body["published_at"] is None and body["previous_available"] is False
    assert [column["menu_name"] for column in body["columns"]] == [menu.name, second.name]
    assert public_footer(site)["description"] == ""

    stale = saved["ETag"]
    newer = client.patch(url, {"description": "Reviewed public footer v2"}, content_type="application/json", HTTP_IF_MATCH=stale)
    assert newer.status_code == 200

    # A stale ETag cannot publish over the newer save.
    assert client.post(f"{url}publish/", HTTP_IF_MATCH=stale).status_code == 412
    assert client.post(f"{url}publish/").status_code == 428
    published = client.post(f"{url}publish/", HTTP_IF_MATCH=newer["ETag"])
    assert published.status_code == 200, published.content
    assert published.json()["has_unpublished_changes"] is False
    assert published.json()["published_at"] is not None
    assert published.json()["lint_warnings"] == []
    assert public_footer(site)["description"] == "Reviewed public footer v2"
    assert [column["heading"] for column in public_footer(site)["columns"]] == ["University", "Explore"]

    draft = client.patch(url, {"description": "Second publication"}, content_type="application/json", HTTP_IF_MATCH=published["ETag"])
    assert draft.status_code == 200
    assert draft.json()["has_unpublished_changes"] is True
    assert public_footer(site)["description"] == "Reviewed public footer v2"
    second = client.post(f"{url}publish/", HTTP_IF_MATCH=draft["ETag"])
    assert second.status_code == 200, second.content
    assert second.json()["previous_available"] is True
    assert public_footer(site)["description"] == "Second publication"

    restored = client.post(f"{url}restore-previous/", HTTP_IF_MATCH=second["ETag"])
    assert restored.status_code == 200, restored.content
    assert restored.json()["settings"]["description"] == "Reviewed public footer v2"
    assert public_footer(site)["description"] == "Second publication"
    assert restored.json()["has_unpublished_changes"] is True

    events = AuditEvent.objects.filter(action="SITE_FOOTER_PUBLISHED", entity_id=str(site.pk))
    assert events.count() == 2 and events.first().actor_id == str(actor.pk)
    assert AuditEvent.objects.filter(action="SITE_FOOTER_RESTORED", entity_id=str(site.pk)).exists()


def test_footer_publication_lint_blocks_and_warns(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-LINT")
    _enable(site, "MENUS")
    _admin(client, oidc, site)
    first = Menu.objects.create(site=site, name="First internal")
    second = Menu.objects.create(site=site, name="Second internal")
    url = f"/api/v1/sites/{site.pk}/footer/"
    etag = client.get(url)["ETag"]

    blocked = client.patch(url, {
        "description": "Main review mainqa-8995d437 University resources",
    }, content_type="application/json", HTTP_IF_MATCH=etag)
    assert blocked.status_code == 200
    response = client.post(f"{url}publish/", HTTP_IF_MATCH=blocked["ETag"])
    assert response.status_code == 400
    assert "review" in str(response.json()["error"]["details"]["description"]).lower()
    assert public_footer(site)["description"] == ""

    reference = client.patch(url, {
        "description": "Public footer",
        "highlight_label": "used as a private design reference",
    }, content_type="application/json", HTTP_IF_MATCH=blocked["ETag"])
    assert reference.status_code == 200
    response = client.post(f"{url}publish/", HTTP_IF_MATCH=reference["ETag"])
    assert response.status_code == 400
    assert "design-reference" in str(response.json()["error"]["details"]["highlight_label"]).lower()

    warnings = client.patch(url, {
        "highlight_label": "",
        "columns": [
            {"menu": str(first.pk), "heading": "Explore", "description": ""},
            {"menu": str(second.pk), "heading": "Explore", "description": ""},
        ],
    }, content_type="application/json", HTTP_IF_MATCH=reference["ETag"])
    assert warnings.status_code == 200
    response = client.post(f"{url}publish/", HTTP_IF_MATCH=warnings["ETag"])
    assert response.status_code == 200, response.content
    assert [warning["path"] for warning in response.json()["lint_warnings"]] == ["columns.1.heading"]


def test_footer_columns_require_owned_menus_and_follow_public_order(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-COLUMNS")
    other = _site(owner, "CHROME-COLUMNS-B")
    _enable(site, "MENUS")
    _enable(other, "MENUS")
    hidden = Menu.objects.create(site=other, name="Other Site menu")
    menu = Menu.objects.create(site=site, name="Internal label")
    _admin(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/footer/"
    etag = client.get(url)["ETag"]
    response = client.patch(url, {"columns": [
        {"menu": str(menu.pk), "heading": "Public heading"},
        {"menu": str(hidden.pk), "heading": "Hidden"},
    ]}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert response.status_code == 400
    assert "columns.1.menu" in response.json()["error"]["details"]
    response = client.patch(url, {"columns": [{"menu": str(menu.pk), "heading": "Public heading"}]}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert response.status_code == 200, response.content
    assert response.json()["settings"]["columns"][0]["heading"] == "Public heading"

    # Renaming the internal menu never changes the public heading.
    nodes = [{"menu": str(menu.pk), "label": menu.name, "column": True}]
    menu.name = "Renamed internal QA copy"
    rendered = apply_footer_column_copy(nodes, [{"menu": str(menu.pk), "heading": "Public heading", "description": "Our team"}])
    assert rendered[0]["label"] == "Public heading"
    assert rendered[0]["description"] == "Our team"


def test_public_footer_uses_published_column_copy_not_internal_menu_names(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-PUBLIC-COLUMNS")
    _enable(site, "MENUS")
    from apps.sites.services.lifecycle import activate_site
    activate_site(site.pk)
    actor = _admin(client, oidc, site)
    menu = Menu.objects.create(site=site, location="footer", name="Main review mainqa-8995d437 University resources")
    from apps.cms.menu_assignment_models import MenuLocationAssignment
    from apps.cms.selectors.menu_delivery import compose_location
    from apps.sites.footer import footer_values
    MenuLocationAssignment.objects.create(site=site, location="footer", is_published=True, published_menu=menu, published_menus=[str(menu.pk)], updated_by=actor)
    row = SiteFooter.objects.create(site=site, columns=[{"menu": str(menu.pk), "heading": "University", "description": "Our institution"}])
    row.published_settings = {**footer_values(row), "columns": [{"menu": str(menu.pk), "heading": "University", "description": "Our institution"}]}
    row.save(update_fields=["published_settings"])
    nodes = compose_location(site.pk, "footer")
    assert nodes[0]["label"] == "University"
    assert nodes[0]["description"] == "Our institution"
    assert nodes[0]["menu"] == str(menu.pk)
    menu.name = "Renamed internal review copy"
    menu.save()
    assert compose_location(site.pk, "footer")[0]["label"] == "University"


def test_header_draft_publish_lint_and_isolation(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-HEADER")
    other = _site(owner, "CHROME-HEADER-B")
    _enable(site, "MENUS", "PAGES")
    _enable(other, "MENUS", "PAGES")
    _admin(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/header/"
    etag = client.get(url)["ETag"]
    quote = "Knowledge serves humanity."
    saved = client.patch(url, {"sticky": True, "brand_quote": quote, "cta_label": "Apply now", "cta_url": "https://example.org/apply"}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert saved.status_code == 200, saved.content
    assert saved.json()["has_unpublished_changes"] is True
    assert public_header(site)["sticky"] is False
    assert public_header(site)["brand_quote"] == ""
    published = client.post(f"{url}publish/", HTTP_IF_MATCH=saved["ETag"])
    assert published.status_code == 200, published.content
    assert public_header(site)["sticky"] is True
    assert public_header(site)["brand_quote"] == quote
    assert public_header(site)["cta_label"] == "Apply now"
    assert SiteHeader.objects.get(site=site).published_by is not None
    AuditEvent.objects.get(action="SITE_HEADER_PUBLISHED", entity_id=str(site.pk))

    # Direct API calls from another Site's administrator, and anonymous calls, are denied.
    assert client.get(f"/api/v1/sites/{other.pk}/header/").status_code == 403
    assert client.post(f"/api/v1/sites/{other.pk}/header/publish/", HTTP_IF_MATCH='"whatever"').status_code == 403
    client.defaults.clear()
    assert client.post(f"{url}publish/", HTTP_IF_MATCH='"whatever"').status_code in (401, 403)


def test_legacy_header_publication_defaults_new_quote_without_false_pending(owner):
    site = _site(owner, "CHROME-HEADER-LEGACY")
    row = SiteHeader.objects.create(site=site)
    row.published_settings = {key: value for key, value in header_values(row).items() if key != "brand_quote"}
    row.save(update_fields=["published_settings"])

    assert public_header(site)["brand_quote"] == ""
    assert header_has_unpublished_changes(row) is False


def test_header_quote_rejects_more_than_280_characters(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-HEADER-QUOTE-LENGTH")
    _enable(site, "MENUS", "PAGES")
    _admin(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/header/"
    etag = client.get(url)["ETag"]

    response = client.patch(url, {"brand_quote": "q" * 281}, content_type="application/json", HTTP_IF_MATCH=etag)

    assert response.status_code == 400
    assert "brand_quote" in str(response.json())


def test_header_lint_blocks_internal_copy(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = _site(owner, "CHROME-HEADER-LINT")
    _enable(site, "MENUS")
    _admin(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/header/"
    etag = client.get(url)["ETag"]
    saved = client.patch(url, {"cta_label": "QA review only", "cta_url": "/apply"}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert saved.status_code == 200, saved.content
    response = client.post(f"{url}publish/", HTTP_IF_MATCH=saved["ETag"])
    assert response.status_code == 400
    assert "cta_label" in response.json()["error"]["details"]
    assert public_header(site)["cta_label"] == ""


def test_lint_policy_and_page_warnings():
    errors, warnings = lint_footer({
        "description": "Lorem ipsum", "links_heading": "Explore", "highlight_label": "",
        "newsletter_label": "", "support_label": "", "copyright_text": "© {year}", "address": "",
        "columns": [
            {"heading": "Explore", "description": ""},
            {"heading": "Explore", "description": ""},
        ],
    })
    assert errors == {"description": "Remove placeholder text before publishing."}
    assert len(warnings) == 1
    layout = {
        "rows": [{"columns": [{"children": [
            {"type": "heading", "props": {"text": "One", "level": "h1"}},
            {"type": "heading", "props": {"text": "Two", "level": "h1"}},
            {"type": "image", "props": {"asset_id": "x", "alt": ""}},
        ]}]}],
    }
    paths = [warning["path"] for warning in lint_page(layout)]
    assert len(paths) == 2
    assert any("alt" in path for path in paths)
    assert any("h1" in warning["message"] for warning in lint_page(layout))
