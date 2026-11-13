"""Published widget providers and Site-owned contact receipts."""
from apps.cms.tests.support import grant_cms_role
import copy
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.api.models import Category, Post
from apps.cms.contact_models import ContactSubmission
from apps.cms.models import Page, ContentRole
from apps.cms.services.workflow import transition_content
from apps.cms.tests.test_public_site_hosts import _host, _publish, _enable, _actor
from apps.cms.tests.support import transition_with_site_role
from apps.media.models import MediaAsset
from apps.media.services import _media_write_session
from apps.sites.services.modules import disable_module_for_site
from apps.sites.models import Module
from apps.cms.api.widget_runtime import ContactThrottle

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(sites, settings, monkeypatch):
    settings.ALLOWED_HOSTS = ["*"]
    monkeypatch.setattr(ContactThrottle, "rate", "100/min")
    for code in ("PAGES", "VISUAL_BUILDER", "POSTS", "MEDIA"):
        _enable(sites, code)
    a, b = sites
    ha, hb = _host(a), _host(b)
    a.refresh_from_db()
    b.refresh_from_db()
    layout = {"schema_version": 1, "rows": [{"id": "row", "type": "section", "ratios": [100], "columns": [
        {"id": "column", "type": "column", "children": [{"id": "form", "type": "contact_form", "props": {"form_code": "contact.v1", "submit_label": "Send"}}]}]}]}
    page = _publish(Page.objects.create(site=a, title="Contact", slug="contact", metadata={"visual_layout": layout}))
    category = Category.objects.create(site=a, code="NEWS", name="News", slug="news")
    unused = Category.objects.create(site=a, code="DRAFT", name="Private category", slug="private")
    first = Post.objects.create(site=a, title="Published A", slug="post-a", content="Body", excerpt="Excerpt A")
    first.categories.add(category)
    _publish(first)
    Post.objects.create(site=a, title="Draft secret", slug="draft", content="Private")
    _publish(Post.objects.create(site=b, title="Foreign secret", slug="post-a", content="Foreign"))
    return a, b, ha, hb, page


def inquiry(**changes):
    return {"request_id": str(uuid.uuid4()), "name": "Visitor", "email": "visitor@example.org", "message": "A question", **changes}


def test_menu_widget_reuses_scoped_published_navigation(world,client):
    from apps.cms.menu_models import Menu,MenuItem
    a,b,ha,hb,page=world
    _enable([a,b],"MENUS")
    own=Menu.objects.create(site=a,location="header",name="Informatics navigation")
    peer=Menu.objects.create(site=b,location="header",name="Medicine navigation")
    MenuItem.objects.create(site=a,menu=own,label="Informatics",item_type=MenuItem.ItemType.CUSTOM,target="/about")
    MenuItem.objects.create(site=b,menu=peer,label="Foreign secret",item_type=MenuItem.ItemType.CUSTOM,target="/medicine")
    url="/api/v1/site-context/widgets/"
    result=client.get(url,{"source":"menu","menu_code":"header"},HTTP_HOST=ha)
    assert result.status_code==200
    assert [item["label"] for item in result.json()["results"]]==["Informatics"]
    assert client.get(url,{"source":"menu","menu_code":"unknown"},HTTP_HOST=ha).status_code==400
    disable_module_for_site(a.pk, Module.objects.get(code="MENUS").pk)
    assert client.get(url,{"source":"menu","menu_code":"header"},HTTP_HOST=ha).status_code==404


def test_widget_data_scopes_published_filtering_and_private_preview(world, client):
    a, b, ha, hb, page = world
    path = "/api/v1/site-context/widgets/"
    data = client.get(path, {"source": "posts", "category": "news"}, HTTP_HOST=ha)
    assert data.status_code == 200
    assert data.json()["site"] == a.pk
    assert [row["title"] for row in data.json()["results"]] == ["Published A"]
    assert data.json()["results"][0]["site"] == a.pk
    assert client.get(path, {"source": "posts", "category": "news"}, HTTP_HOST=hb).json()["results"] == []
    terms = client.get(path, {"source": "taxonomy"}, HTTP_HOST=ha).json()["results"]
    assert [term["name"] for term in terms] == ["News"]
    assert client.get(path, {"source": "posts", "limit": 999}, HTTP_HOST=ha).status_code == 400
    assert client.get(path + "?source=posts&source=identity", HTTP_HOST=ha).status_code == 400
    assert client.get(path, {"source": "identity", "site": b.pk}, HTTP_HOST=ha).status_code == 400
    actor = _actor("widget-author")
    grant_cms_role(site=a, user=actor, role=ContentRole.AUTHOR)
    api = APIClient()
    api.force_authenticate(actor)
    private = api.get(f"/api/v1/sites/{a.pk}/pages/{page.pk}/widget-data/?source=posts")
    assert private.status_code == 200 and "no-store" in private["Cache-Control"]
    assert api.get(f"/api/v1/sites/{b.pk}/pages/{page.pk}/widget-data/?source=identity").status_code in (403, 404)


def test_contact_validation_replay_and_foreign_host_have_no_partial_writes(world, client):
    a, b, ha, hb, page = world
    path = f"/api/v1/site-context/contact/{page.pk}/contact.v1/"
    body = inquiry()
    invalid = client.post(path, inquiry(email="invalid"), content_type="application/json", HTTP_HOST=ha)
    assert invalid.status_code == 400 and ContactSubmission.objects.count() == 0
    assert client.post(path, body, content_type="application/json", HTTP_HOST=hb).status_code == 404
    assert client.post(path, body, content_type="application/json", HTTP_HOST=ha, HTTP_ORIGIN="https://foreign.example").status_code == 403
    valid = client.post(path, body, content_type="application/json", HTTP_HOST=ha)
    assert valid.status_code == 202 and "no-store" in valid["Cache-Control"]
    assert set(valid.json()) == {"id", "status"}
    replay = client.post(path, body, content_type="application/json", HTTP_HOST=ha)
    assert replay.json() == valid.json()
    assert ContactSubmission.objects.count() == 1
    conflict = client.post(path, {**body, "message": "Changed"}, content_type="application/json", HTTP_HOST=ha)
    assert conflict.status_code == 409
    row = ContactSubmission.objects.get()
    assert row.site_id == a.pk and row.page_id == page.pk and row.message == body["message"]
    with pytest.raises(IntegrityError), transaction.atomic():
        ContactSubmission.objects.filter(pk=row.pk).update(site=b)


def test_contact_requires_current_published_form_and_module(world, client):
    a, b, ha, hb, page = world
    path = f"/api/v1/site-context/contact/{page.pk}/contact.v1/"
    assert client.post(path.replace("contact.v1", "other"), inquiry(), content_type="application/json", HTTP_HOST=ha).status_code == 404
    transition_with_site_role(page, "unpublish", _actor("unpublish-contact"))
    assert client.post(path, inquiry(), content_type="application/json", HTTP_HOST=ha).status_code == 404
    assert ContactSubmission.objects.count() == 0


def test_contact_rate_limit_is_site_local(world, client, monkeypatch):
    a, b, ha, hb, page = world
    monkeypatch.setattr(ContactThrottle, "rate", "5/min")
    path = f"/api/v1/site-context/contact/{page.pk}/contact.v1/"
    for _ in range(5):
        assert client.post(path, inquiry(), content_type="application/json", HTTP_HOST=ha).status_code == 202
    assert client.post(path, inquiry(), content_type="application/json", HTTP_HOST=ha).status_code == 429
    assert client.post(path, inquiry(), content_type="application/json", HTTP_HOST=hb).status_code == 404
    assert ContactSubmission.objects.count() == 5


def test_site_logo_configuration_cannot_resolve_foreign_asset(world, client):
    a, b, ha, hb, page = world
    actor = _actor("logo-seed")
    with _media_write_session(actor, b.pk):
        foreign = MediaAsset.objects.create(site=b, storage_reference=f"platform-private:sites/{b.pk}/review/{uuid.uuid4()}",
            original_filename="logo.png", detected_mime="image/png", byte_count=10, checksum="a" * 64, status="PENDING",
            created_by=actor, updated_by=actor)
        foreign.status = "READY"
        foreign.save(update_fields=("status",))
    config = copy.deepcopy(a.configuration)
    config["identity"]["display_name"] = "Informatics identity"
    config["identity"]["logo_ref"] = str(foreign.pk)
    a.configuration = config
    a.save(update_fields=("configuration",))
    identity = client.get("/api/v1/site-context/widgets/?source=identity", HTTP_HOST=ha).json()
    assert identity["results"] == [{"name": "Informatics identity", "logo_asset_id": None, "logo_url": None}]
    assert client.get("/api/v1/site-context/identity/logo/", HTTP_HOST=ha).status_code == 404
    from django.core.management import call_command
    from apps.authorization.models import Role, UserRoleAssignment
    from apps.media.removal import remove_asset
    from apps.sites.api.access import Conflict
    call_command("seed_rbac", verbosity=0)
    UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code="site-administrator"),
                                      scope="SITE", site=b, organization=b.organization_unit)
    b.configuration["identity"]["logo_ref"] = str(foreign.pk)
    b.save(update_fields=("configuration",))
    with pytest.raises(Conflict):
        remove_asset(actor, b.pk, foreign.pk)
    foreign.refresh_from_db()
    assert foreign.deleted_at is None
