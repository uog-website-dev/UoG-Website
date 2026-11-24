"""Site scoped Document CRUD and query contracts."""
from uuid import uuid4
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from apps.cms.models import ContentRole, Document, DocumentCategory, ContentRevision, ContentWorkflowTransition
from apps.cms.tests.support import grant_cms_role
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site, disable_module_for_site
from apps.media.models import MediaAsset
from apps.media.services import asset_write, update_asset

pytestmark = pytest.mark.django_db
DOCS = "/api/v1/sites/{site}/documents/"

@pytest.fixture
def document_editor(client, oidc, sites):
    user = get_user_model().objects.create_user(username="documents-editor")
    grant_cms_role(site=sites[0], user=user, role=ContentRole.AUTHOR)
    client.defaults.update(oidc.header(sub=str(uuid4()), preferred_username=user.username, email="documents@uog.et"))
    call_command("seed_rbac", verbosity=0)
    for code in ("MEDIA", "DOCUMENTS"):
        module = Module.objects.get(code=code)
        if not module.is_enabled:
            module.is_enabled = True
            module.save(update_fields=("is_enabled",))
        for site in sites: enable_module_for_site(site.pk, module.pk)
    assets=[]
    foreign_user=get_user_model().objects.create_user(username="documents-foreign-editor")
    grant_cms_role(site=sites[1],user=foreign_user,role=ContentRole.AUTHOR)
    for index, (site, actor) in enumerate(((sites[0],user),(sites[1],foreign_user))):
        with asset_write(actor,site.pk,"content.media.upload"):
            asset=MediaAsset.objects.create(site=site,storage_reference=f"platform-private:sites/{site.pk}/{uuid4()}.pdf",original_filename=f"report-{index}.pdf",detected_mime="application/pdf",byte_count=100,checksum="a"*64,created_by=actor,updated_by=actor)
        update_asset(actor,site.pk,asset.pk,changes={"status":"READY"})
        assets.append(asset)
    admin=get_user_model().objects.create_user(username="documents-site-admin")
    from apps.authorization.models import Role, UserRoleAssignment
    site_admin_role=Role.objects.get(code="site-administrator",is_system=True)
    UserRoleAssignment.objects.create(user=admin,role=site_admin_role,scope="SITE",site=sites[0],organization=sites[0].organization_unit)
    admin_client=client.__class__()
    admin_client.defaults.update(oidc.header(sub=str(uuid4()),preferred_username=admin.username,email="documents-admin@uog.et"))
    return client, user, assets, oidc, admin_client, foreign_user

def test_documents_create_search_pagination_site_boundary_and_disabled(document_editor, sites):
    client, user, assets, oidc, admin_client, foreign_user = document_editor
    site, other = sites
    base = DOCS.format(site=site.pk)
    missing = client.post(base, {"slug":"missing","file_reference":"missing.pdf"}, content_type="application/json")
    assert missing.status_code == 400 and "title" in missing.json()["error"]["details"]
    category = DocumentCategory.objects.create(site=site,slug="documents",name="Documents")
    created = client.post(base, {"title":"Annual Report","slug":"annual-report","file_reference":f"sites/{site.pk}/assets/{assets[0].pk}","categories":[str(category.pk)],"version":"2"}, content_type="application/json")
    assert created.status_code == 201, created.content
    doc_id = created.json()["id"]
    assert Document.objects.get(pk=doc_id).site_id == site.pk
    assert Document.objects.get(pk=doc_id).categories.filter(pk=category.pk).exists(), created.json()
    foreign = Document.objects.create(site=other,title="Foreign",slug="foreign",file_reference=f"sites/{other.pk}/assets/{assets[1].pk}",created_by=foreign_user,updated_by=foreign_user)
    assert client.get(base + f"{foreign.pk}/").status_code == 404
    assert admin_client.get(base + f"{foreign.pk}/").status_code == 404
    assert admin_client.patch(base + f"{foreign.pk}/",{"title":"IDOR"},content_type="application/json").status_code == 404
    assert admin_client.get(DOCS.format(site=other.pk)+f"{foreign.pk}/").status_code == 403
    second = client.post(base,{"title":"Annual Addendum","slug":"annual-addendum","file_reference":f"sites/{site.pk}/assets/{assets[0].pk}","visibility":"HIDDEN"},content_type="application/json")
    assert second.status_code == 201, second.content
    page_one=client.get(base+"?search=Annual&page_size=1").json()
    assert page_one["count"] == 2 and page_one["next"]
    assert client.get(base + f"?search=Foreign").json()["count"] == 0
    assert client.get(base + f"?category={category.pk}").json()["count"] == 1
    assert client.get(base + "?status=DRAFT").json()["count"] == 2
    assert client.get(base + "?file_type=pdf").json()["count"] == 2
    assert client.get(base + "?visibility=HIDDEN").json()["count"] == 1
    before = created.json()["id"]
    edited = client.patch(base + f"{doc_id}/", {"description":"Updated"}, content_type="application/json")
    assert edited.status_code == 200 and edited.json()["id"] == before
    assert ContentRevision.objects.filter(content_id=doc_id).count() >= 2
    assert client.delete(base+f"{doc_id}/").status_code == 403
    published=admin_client.post(base+f"{doc_id}/publish/",{},content_type="application/json")
    assert published.status_code==200,published.content
    history_before=ContentWorkflowTransition.objects.filter(content_id=doc_id).count()
    edited_published=client.patch(base+f"{doc_id}/",{"description":"Preserve publication"},content_type="application/json")
    assert edited_published.status_code==200 and edited_published.json()["id"]==doc_id
    assert ContentWorkflowTransition.objects.filter(content_id=doc_id).count()==history_before
    assert ContentRevision.objects.filter(content_id=doc_id).count() >= 5
    assert admin_client.post(base+f"{doc_id}/unpublish/",{},content_type="application/json").status_code==200
    outsider = get_user_model().objects.create_user(username="documents-outsider")
    client.defaults.update(oidc.header(sub=str(uuid4()), preferred_username=outsider.username, email="outside@uog.et"))
    assert client.post(base, {"title":"Denied","slug":"denied","file_reference":"d.pdf"}, content_type="application/json").status_code == 403
    assert client.patch(base+f"{doc_id}/",{"title":"Denied"},content_type="application/json").status_code == 403
    assert client.delete(base+f"{doc_id}/").status_code == 403
    disable_module_for_site(site.pk, Module.objects.get(code="DOCUMENTS").pk)
    assert client.get(base).status_code == 400
