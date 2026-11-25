"""Document CRUD, scoping, revision history and module gates."""
from uuid import uuid4
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.cms.models import ContentRole, Document
from apps.api.models import Category
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
    category = Category.objects.create(site=site, kind=Category.Kind.DOCUMENTS, code="DOC_POLICIES", name="Policies", slug="policies")
    second_category = Category.objects.create(site=site, kind=Category.Kind.DOCUMENTS, code="DOC_ACADEMIC", name="Academic Forms", slug="academic-forms")
    created = add(client, site, "Academic policy", categories=[str(category.pk), str(second_category.pk)], version="1.0")
    assert created.status_code == 201, created.content
    data = created.json()
    assert data["status"] == "DRAFT" and data["site"] == site.pk
    assert set(data["categories"]) == {str(category.pk), str(second_category.pk)}
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
    assert client.post(ROOT.format(site=site.pk) + "categories/", {"name":"Forbidden"}, content_type="application/json").status_code == 403
    category = Category.objects.create(site=site, kind=Category.Kind.DOCUMENTS, code="DOC_VIEWER_DELETE", name="Protected", slug="protected")
    assert client.delete(ROOT.format(site=site.pk) + f"categories/{category.pk}/").status_code == 403
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


def test_document_taxonomy_create_rename_deactivate_and_delete_rules(document_client, sites):
    client, user = document_client
    site, other = sites
    from apps.authorization.models import Role, UserRoleAssignment
    call_command("seed_rbac", verbosity=0)
    UserRoleAssignment.objects.create(user=user, site=site, organization=site.organization_unit,
        role=Role.objects.get(code="site-administrator"), scope="SITE")
    endpoint = ROOT.format(site=site.pk) + "categories/"
    created = client.post(endpoint, {"name": "Policies & Regulations", "description": "Official rules", "position": 2}, content_type="application/json")
    assert created.status_code == 201, created.content
    payload = created.json()
    category_id = payload["id"]
    category = Category.objects.get(pk=category_id)
    assert category.kind == Category.Kind.DOCUMENTS and payload["slug"] == "policies-regulations"
    doc = add(client, site, "Policy", categories=[category_id])
    assert doc.status_code == 201, doc.content
    renamed = client.patch(endpoint + f"{category_id}/", {"name": "Updated Policies", "slug": "updated-policies"}, content_type="application/json")
    assert renamed.status_code == 200, renamed.content
    assert Document.objects.get(pk=doc.json()["id"]).categories.get().name == "Updated Policies"
    assert client.delete(endpoint + f"{category_id}/").status_code == 400
    assert Document.objects.get(pk=doc.json()["id"]).categories.exists()
    inactive = client.patch(endpoint + f"{category_id}/", {"is_active": False}, content_type="application/json")
    assert inactive.status_code == 200 and inactive.json()["is_active"] is False
    assert Document.objects.get(pk=doc.json()["id"]).categories.exists()
    assert client.get(ROOT.format(site=other.pk) + f"categories/{category_id}/").status_code == 403
    assert client.patch(ROOT.format(site=other.pk) + f"categories/{category_id}/", {"name": "Intrusion"}, content_type="application/json").status_code == 403


def test_document_taxonomy_duplicate_slug_and_cross_site_assignment(document_client, sites):
    client, user = document_client
    site, other = sites
    from apps.authorization.models import Role, UserRoleAssignment
    call_command("seed_rbac", verbosity=0)
    UserRoleAssignment.objects.create(user=user, site=site, organization=site.organization_unit,
        role=Role.objects.get(code="site-administrator"), scope="SITE")
    endpoint = ROOT.format(site=site.pk) + "categories/"
    first = client.post(endpoint, {"name": "Academic Forms"}, content_type="application/json")
    assert first.status_code == 201, first.content
    duplicate = client.post(endpoint, {"name": "Academic Forms", "slug": "academic-forms"}, content_type="application/json")
    assert duplicate.status_code == 400
    foreign = client.post(ROOT.format(site=other.pk) + "categories/", {"name": "External"}, content_type="application/json")
    assert foreign.status_code == 403
    foreign_category = Category.objects.create(site=other, kind=Category.Kind.DOCUMENTS, code="DOC_EXTERNAL", name="External", slug="external")
    rejected = add(client, site, "Bad association", categories=[str(foreign_category.pk)])
    assert rejected.status_code == 400


def test_public_document_category_filter_is_site_and_publication_scoped(document_client, sites):
    client, user = document_client
    site, other = sites
    from apps.sites.models import SiteDomain
    from apps.sites.services.lifecycle import activate_site
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname=f"docs-{site.pk}.uog.edu.et", is_primary=True, status="ACTIVE")
    category = Category.objects.create(site=site, kind=Category.Kind.DOCUMENTS, code="DOC_PUBLIC", name="Policies", slug="policies")
    document = Document.objects.create(site=site, title="Public policy", slug="public-policy", file_reference=f"sites/{site.pk}/assets/{uuid4()}", created_by=user, updated_by=user)
    document.categories.add(category)
    transition_with_site_role(document, "submit", user)
    reviewer = get_user_model().objects.create_user(username="doc-public-reviewer")
    transition_with_site_role(document, "approve", reviewer)
    publisher = get_user_model().objects.create_user(username="doc-public-publisher")
    transition_with_site_role(document, "publish", publisher)
    hidden_category = Category.objects.create(site=site, kind=Category.Kind.DOCUMENTS, code="DOC_HIDDEN", name="Hidden category", slug="hidden-category", is_active=False)
    hidden_document = Document.objects.create(site=site, title="Hidden policy", slug="hidden-policy", file_reference=f"sites/{site.pk}/assets/{uuid4()}", visibility="HIDDEN", created_by=user, updated_by=user)
    hidden_document.categories.add(category)
    transition_with_site_role(hidden_document, "submit", user)
    hidden_reviewer = get_user_model().objects.create_user(username="doc-hidden-reviewer")
    transition_with_site_role(hidden_document, "approve", hidden_reviewer)
    hidden_publisher = get_user_model().objects.create_user(username="doc-hidden-publisher")
    transition_with_site_role(hidden_document, "publish", hidden_publisher)
    inactive_document = Document.objects.create(site=site, title="Inactive category policy", slug="inactive-category-policy", file_reference=f"sites/{site.pk}/assets/{uuid4()}", created_by=user, updated_by=user)
    inactive_document.categories.add(hidden_category)
    transition_with_site_role(inactive_document, "submit", user)
    inactive_reviewer = get_user_model().objects.create_user(username="doc-inactive-reviewer")
    transition_with_site_role(inactive_document, "approve", inactive_reviewer)
    inactive_publisher = get_user_model().objects.create_user(username="doc-inactive-publisher")
    transition_with_site_role(inactive_document, "publish", inactive_publisher)
    from apps.api.models import Category as TaxonomyCategory
    foreign = TaxonomyCategory.objects.create(site=other, kind=TaxonomyCategory.Kind.DOCUMENTS, code="DOC_FOREIGN", name="Foreign", slug="foreign")
    root = "/api/v1/site-context/documents/"
    response = client.get(root + "?category=policies", HTTP_HOST=f"docs-{site.pk}.uog.edu.et")
    assert response.status_code == 200 and response.json()["count"] == 1
    assert response.json()["results"][0]["id"] == str(document.pk)
    assert client.get(root + "?category=foreign", HTTP_HOST=f"docs-{site.pk}.uog.edu.et").json()["count"] == 0
    assert client.get(root + "?category=hidden-category", HTTP_HOST=f"docs-{site.pk}.uog.edu.et").json()["count"] == 0
    public_categories = client.get(root + "categories/", HTTP_HOST=f"docs-{site.pk}.uog.edu.et").json()
    assert [row["id"] for row in public_categories] == [str(category.pk)]
