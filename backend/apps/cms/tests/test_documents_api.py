"""Document CRUD, scoping, revision history and module gates."""
from uuid import uuid4
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.cms.models import ContentRole, Document, DocumentCategory
from apps.cms.tests.support import grant_cms_role, transition_with_site_role
from apps.sites.models import Module
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

pytestmark = pytest.mark.django_db
ROOT = "/api/v1/sites/{site}/documents/"


def token(oidc, username):
    return oidc.header(sub=str(uuid4()), preferred_username=username,
                       email=f"{username}@uog.et", realm_access={"roles": ["platform-viewer"]})


@pytest.fixture
def document_client(client, oidc, sites, monkeypatch):
    """Site Editor with a scan-ready Site-owned test file."""
    call_command("seed_rbac", verbosity=0)
    user = get_user_model().objects.create_user(username="document-editor")
    grant_cms_role(site=sites[0], user=user, role=ContentRole.AUTHOR)
    client.defaults.update(token(oidc, user.username))
    assert client.get("/api/me/").status_code == 200
    media, _ = Module.objects.get_or_create(code="MEDIA", defaults={"name":"Media","description":"Site media","status":"IMPLEMENTED","is_enabled":True})
    media.is_enabled = True
    media.save(update_fields=("is_enabled",))
    documents, _ = Module.objects.get_or_create(code="DOCUMENTS", defaults={"name":"Documents","description":"Documents","status":"IMPLEMENTED","is_enabled":True})
    documents.is_enabled = True
    documents.save(update_fields=("is_enabled",))
    for site in sites:
        enable_module_for_site(site.pk, media.pk)
        enable_module_for_site(site.pk, documents.pk)
    asset = SimpleNamespace(detected_mime="application/pdf", original_filename="policy.pdf", byte_count=42)
    monkeypatch.setattr("apps.media.document_references.validate_document_file", lambda *args, **kwargs: asset)
    monkeypatch.setattr("apps.media.document_references.record_document_file", lambda *args, **kwargs: None)
    return client, user


def add(client, site, title, **extra):
    payload = {"title": title, "file_reference": f"sites/{site.pk}/assets/{uuid4()}", **extra}
    return client.post(ROOT.format(site=site.pk), payload, content_type="application/json")


def test_create_edit_validation_search_filters_and_pagination(document_client, sites):
    client, user = document_client
    site, other = sites
    category = DocumentCategory.objects.create(site=site, name="Policies", slug="policies")
    created = add(client, site, "Academic policy", categories=[str(category.pk)], version="1.0")
    assert created.status_code == 201, created.content
    data = created.json()
    assert data["status"] == "DRAFT" and data["site"] == site.pk
    assert data["categories"] == [str(category.pk)]
    identifier, original_revision = data["id"], data["revision_number"]
    edited = client.patch(ROOT.format(site=site.pk) + f"{identifier}/", {"description":"Reviewed details"}, content_type="application/json")
    assert edited.status_code == 200, edited.content
    assert edited.json()["id"] == identifier
    assert edited.json()["revision_number"] > original_revision
    assert Document.objects.get(pk=identifier).updated_by == user
    assert client.get(ROOT.format(site=other.pk) + f"{identifier}/").status_code == 403
    assert client.patch(ROOT.format(site=other.pk) + f"{identifier}/", {"title":"Foreign edit"}, content_type="application/json").status_code == 403
    assert add(client, site, " ").status_code == 400
    missing_title = client.post(ROOT.format(site=site.pk), {"file_reference":f"sites/{site.pk}/assets/{uuid4()}"}, content_type="application/json")
    assert missing_title.status_code == 400 and "title" in missing_title.json()["error"]["details"]
    second = add(client, site, "Finance procedures")
    assert second.status_code == 201
    third = add(client, site, "Library access")
    assert third.status_code == 201
    assert add(client, other, "Other Site confidential").status_code == 403
    query = client.get(ROOT.format(site=site.pk) + "?search=academic&category=" + str(category.pk) + "&status=DRAFT&page=1&page_size=1")
    assert query.status_code == 200 and query.json()["count"] == 1
    assert [row["id"] for row in query.json()["results"]] == [identifier]
    assert client.get(ROOT.format(site=site.pk) + "?search=Other+Site").json()["count"] == 0
    paginated = client.get(ROOT.format(site=site.pk) + "?page=1&page_size=1")
    assert paginated.status_code == 200 and paginated.json()["count"] == 3
    assert paginated.json()["next"] and len(paginated.json()["results"]) == 1


def test_permission_and_disabled_module_gates(document_client, sites, oidc, client):
    client, _ = document_client
    site, _ = sites
    viewer = get_user_model().objects.create_user(username="document-viewer")
    call_command("seed_rbac", verbosity=0)
    from apps.authorization.models import Role, UserRoleAssignment
    UserRoleAssignment.objects.create(user=viewer, site=site, organization=site.organization_unit,
        role=Role.objects.get(code="viewer"), scope="SITE")
    client.defaults.update(token(oidc, viewer.username))
    assert client.post(ROOT.format(site=site.pk), {"title":"Forbidden"}, content_type="application/json").status_code == 403
    record = Document.objects.create(site=site, title="Policy", slug=f"policy-{uuid4().hex[:6]}", file_reference=f"sites/{site.pk}/assets/{uuid4()}", created_by=viewer, updated_by=viewer)
    assert client.patch(ROOT.format(site=site.pk) + f"{record.pk}/", {"title":"Changed"}, content_type="application/json").status_code == 403
    assert client.delete(ROOT.format(site=site.pk) + f"{record.pk}/").status_code == 403
    disable_module_for_site(site.pk, Module.objects.get(code="DOCUMENTS").pk)
    assert client.get(ROOT.format(site=site.pk)).status_code == 404
    assert client.get(ROOT.format(site=site.pk) + f"{record.pk}/").status_code == 404


def test_edit_keeps_publication_history_and_file_references(document_client, sites):
    client, author = document_client
    site, _ = sites
    created = add(client, site, "Annual report")
    assert created.status_code == 201, created.content
    document = Document.objects.get(pk=created.json()["id"])
    transition_with_site_role(document, "submit", author)
    reviewer = get_user_model().objects.create_user(username="document-reviewer")
    transition_with_site_role(document, "approve", reviewer)
    publisher = get_user_model().objects.create_user(username="document-publisher")
    transition_with_site_role(document, "publish", publisher)
    published_at = Document.objects.get(pk=document.pk).published_at
    revision_count = document.revisions.count()
    edited = client.patch(ROOT.format(site=site.pk) + f"{document.pk}/", {"version":"2026"}, content_type="application/json")
    assert edited.status_code == 200, edited.content
    current = Document.objects.get(pk=document.pk)
    assert current.pk == document.pk and current.status == "PUBLISHED"
    assert current.published_at == published_at
    assert current.revisions.count() == revision_count + 1
