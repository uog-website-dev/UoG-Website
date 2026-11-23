"""Starting documents share the builder contract and never mutate CMS state."""
import copy
import pytest
from django.core.exceptions import ValidationError
from apps.cms import homepage_templates as domain
from apps.cms.layout_contract import validate_layout, iter_nodes
from apps.cms.models import Page, ContentRevision, PublishedContentSnapshot
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site, disable_module_for_site
from apps.authorization.models import Role, UserRoleAssignment
from tests.test_media_derivatives import derivative_storage
from .test_menu_api import api, ready
pytestmark = pytest.mark.django_db


def endpoint(api):
    for code in ('PAGES','VISUAL_BUILDER','MEDIA'):
        module=Module.objects.get(code=code)
        if not module.is_enabled:
            module.is_enabled=True;module.save(update_fields=['is_enabled'])
        enable_module_for_site(api.site.pk,module.pk)
    return f'/api/v1/sites/{api.site.pk}/homepage-templates/'


def bindings(api):
    if not hasattr(api,'template_image'):
        from tests.test_site_appearance_api import _ready_logo
        api.template_image=_ready_logo(api.site,api.user)
    return {code:{'asset_id':str(api.template_image.pk),'alt':'Approved campus photograph'} for code in ('hero','campus')}


def inventory(api):
    api.site.refresh_from_db()
    return (Page.objects.count(),ContentRevision.objects.count(),PublishedContentSnapshot.objects.count(),api.site.homepage_id,copy.deepcopy(api.site.configuration))


def test_catalogue_and_preparation_never_write_pages_or_settings(api):
    url=endpoint(api);before=inventory(api)
    response=api.client.get(url,**api.header)
    assert response.status_code==200,response.content
    entries=response.json()
    assert [entry['name'] for entry in entries]==['University Main','College/Department','Blank']
    assert all(entry['available'] for entry in entries)
    assert response['Cache-Control']=='private, no-store'
    for entry in entries:
        assert validate_layout(entry['layout'])==entry['layout']
        prepared=api.client.post(url+'prepare/',{'template_id':entry['id'],'version':entry['version'],'assets':bindings(api) if entry['id']!='blank' else {}},content_type='application/json',**api.header)
        assert prepared.status_code==200,prepared.content
        result=prepared.json()['visual_layout'];validate_layout(result)
        assert result['rows']==[] if entry['id']=='blank' else result['rows']
        again=domain.prepare_template(api.site.pk,entry['id'],entry['version'],assets=bindings(api) if entry['id']!='blank' else {})['visual_layout']
        ids={node['id'] for node,_ in iter_nodes(result)}
        assert not ids & {node['id'] for node,_ in iter_nodes(again)}
    assert inventory(api)==before


def test_starter_manifests_use_site_bound_widgets_and_editable_sections(api):
    endpoint(api)
    for template_id in ('university-main','college-department'):
        prepared=domain.prepare_template(api.site.pk,template_id,4,assets=bindings(api))['visual_layout']
        kinds={node['type'] for node,_ in iter_nodes(prepared)}
        assert {'hero_image','layout_slider','headline','editor','button_grid','loop_grid','tabs','contact_form'} <= kinds
        assert not {'site_logo','site_title','menu'} & kinds
        news=[node for node,_ in iter_nodes(prepared) if node['type']=='loop_grid']
        assert len(news)==1 and news[0]['props']['source']=='posts'
        assert all(node['props']['asset_id']==str(api.template_image.pk) for node,_ in iter_nodes(prepared) if node['type']=='hero_image')


@pytest.mark.parametrize('field,value',[('manifest_version',2),('version',0)])
def test_unsupported_manifest_is_unavailable_and_cannot_be_prepared(api,monkeypatch,field,value):
    url=endpoint(api);bad=copy.deepcopy(domain.MANIFESTS[0]);bad[field]=value
    monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    entry=api.client.get(url,**api.header).json()[0]
    assert not entry['available'] and entry['layout'] is None and entry['unavailable_reasons']
    assert api.client.post(url+'prepare/',{'template_id':bad['id'],'version':1},content_type='application/json',**api.header).status_code==400


@pytest.mark.parametrize('kind',['unknown','schema','foreign'])
def test_unknown_components_versions_and_site_bound_assets_are_rejected(api,monkeypatch,kind):
    url=endpoint(api);bad=copy.deepcopy(domain.MANIFESTS[0])
    if kind=='unknown':bad['layout']['rows'][0]['columns'][0]['children'][0]['type']='unregistered'
    elif kind=='schema':bad['layout']['schema_version']=999
    else:bad['layout']['rows'][0]['columns'][0]['children'][0]={'id':'foreign','type':'image','props':{'asset_id':'11111111-1111-1111-1111-111111111111','alt':'Foreign'}}
    monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    assert not api.client.get(url,**api.header).json()[0]['available']
    assert api.client.post(url+'prepare/',{'template_id':bad['id'],'version':1},content_type='application/json',**api.header).status_code==400


def test_homepage_template_news_must_be_site_posts(api,monkeypatch):
    url=endpoint(api);bad=copy.deepcopy(domain.MANIFESTS[0])
    grid=next(node for node,_ in iter_nodes(bad['layout']) if node['type']=='loop_grid')
    grid['props']['source']='pages'
    monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    entry=api.client.get(url,**api.header).json()[0]
    assert not entry['available'] and entry['layout'] is None
    assert api.client.post(url+'prepare/',{'template_id':bad['id'],'version':4},content_type='application/json',**api.header).status_code==400


def test_permissions_isolation_expiration_and_module_contract(api):
    url=endpoint(api)
    assert api.client.get(url).status_code==401
    assert api.client.post(url+'prepare/',{},content_type='application/json').status_code==401
    foreign=f'/api/v1/sites/{api.other.pk}/homepage-templates/'
    assert api.client.get(foreign,**api.header).status_code==403
    assert api.client.post(foreign+'prepare/',{'template_id':'blank','version':1},content_type='application/json',**api.header).status_code==403
    assignment=UserRoleAssignment.objects.get(user=api.user)
    assignment.role=Role.objects.get(code='viewer');assignment.save()
    assert api.client.get(url,**api.header).status_code==403
    assert api.client.post(url+'prepare/',{'template_id':'blank','version':1},content_type='application/json',**api.header).status_code==403
    assignment.role=Role.objects.get(code='editor');assignment.save()
    assert api.client.get(url,**api.header).status_code==200
    disable_module_for_site(api.site.pk,Module.objects.get(code='VISUAL_BUILDER').pk)
    entries=api.client.get(url,**api.header).json();assert not any(entry['available'] for entry in entries)
    assert api.client.post(url+'prepare/',{'template_id':'blank','version':1},content_type='application/json',**api.header).status_code==400
    assert api.client.post(url+'apply/',{'template_id':'blank','version':1,'mode':'new'},content_type='application/json',HTTP_IDEMPOTENCY_KEY='disabled-apply',**api.header).status_code==400


def test_forged_input_stale_version_and_deterministic_cross_site_catalogue(api):
    url=endpoint(api)
    for code in ('PAGES','VISUAL_BUILDER','MEDIA'):enable_module_for_site(api.other.pk,Module.objects.get(code=code).pk)
    assert domain.catalogue(api.site.pk)==domain.catalogue(api.other.pk)
    for payload in ({'template_id':'blank','version':2},{'template_id':'unknown','version':1},{'template_id':'blank','version':1,'layout':{}},{'template_id':'blank','version':1,'site':api.other.pk}):
        assert api.client.post(url+'prepare/',payload,content_type='application/json',**api.header).status_code==400
    assert api.client.get(url+'?site='+str(api.other.pk),**api.header).status_code==400


def test_selected_template_saves_via_existing_revision_contract(api):
    from apps.cms.services.pages import create_page
    from apps.cms.services.working_drafts import content_etag
    endpoint(api)
    page=create_page(site=api.site,title="Template draft",slug="template-draft",actor=api.user)
    original_revision=page.revision_number
    prepared=domain.prepare_template(api.site.pk,'university-main',4,assets=bindings(api))['visual_layout']
    url=f'/api/v1/sites/{api.site.pk}/pages/{page.pk}/visual-draft/'
    tag=content_etag(page)
    result=api.client.patch(url,{'visual_layout':prepared},content_type='application/json',HTTP_IF_MATCH=tag,**api.header)
    assert result.status_code==200,result.content
    page.refresh_from_db();assert page.metadata['visual_layout']==prepared
    assert page.revisions.filter(revision_number=original_revision).exists()
    stale=api.client.patch(url,{'visual_layout':{'schema_version':1,'rows':[]}},content_type='application/json',HTTP_IF_MATCH=tag,**api.header)
    assert stale.status_code==409
    page.refresh_from_db();assert page.metadata['visual_layout']==prepared
    assert not PublishedContentSnapshot.objects.filter(content=page).exists()


def test_apply_creates_idempotent_editable_draft_without_assigning_homepage(api):
    url=endpoint(api)
    prior_homepage=api.site.homepage_id
    payload={'template_id':'university-main','version':4,'assets':bindings(api),'mode':'new','title':'New Main Draft'}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IDEMPOTENCY_KEY='apply-main-001',**api.header)
    assert result.status_code==201,result.content
    data=result.json();page=Page.objects.get(pk=data['id'])
    assert page.status=='DRAFT' and page.is_homepage is False
    assert [node['type'] for node,_ in iter_nodes(page.metadata['visual_layout'])]==[node['type'] for node,_ in iter_nodes(domain.prepare_template(api.site.pk,'university-main',4,assets=bindings(api))['visual_layout'])]
    assert page.metadata['template_application']=={'id':'university-main','version':4,'idempotency_key':'apply-main-001'}
    assert page.revisions.exists()
    assert api.site.homepage_id==prior_homepage
    retry=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IDEMPOTENCY_KEY='apply-main-001',**api.header)
    assert retry.status_code==200 and retry.json()['id']==data['id']
    assert Page.objects.filter(site=api.site,metadata__template_application__idempotency_key='apply-main-001').count()==1
    assert api.client.get(f"/api/v1/sites/{api.site.pk}/pages/{page.pk}/visual-draft/",**api.header).status_code==200
    etag=result["ETag"]
    edited=api.client.patch(f"/api/v1/sites/{api.site.pk}/pages/{page.pk}/visual-draft/",{'visual_layout':{'schema_version':1,'rows':[]}},content_type='application/json',HTTP_IF_MATCH=etag,**api.header)
    assert edited.status_code==200,edited.content
    reopened=api.client.get(f"/api/v1/sites/{api.site.pk}/pages/{page.pk}/visual-draft/",**api.header)
    assert reopened.status_code==200 and reopened.json()['metadata']['visual_layout']=={'schema_version':1,'rows':[]}


def test_apply_replaces_only_current_editable_draft_and_checks_revision(api):
    from apps.cms.services.pages import create_page
    from apps.cms.services.working_drafts import content_etag
    url=endpoint(api);page=create_page(site=api.site,title='Editable',slug='editable',actor=api.user)
    before=page.revision_number
    payload={'template_id':'college-department','version':4,'assets':bindings(api),'mode':'replace','page_id':str(page.pk)}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=content_etag(page),**api.header)
    assert result.status_code==200,result.content
    page.refresh_from_db()
    assert page.revision_number==before+1
    assert page.metadata['template_application']=={'id':'college-department','version':4}
    assert page.revisions.filter(revision_number=before).exists()
    stale=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=f'"cms-content-{page.pk}-r{before}"',**api.header)
    assert stale.status_code==409
    assert page.revision_number==before+1


def test_apply_rejects_unauthorized_invalid_and_cross_site_targets_atomically(api):
    from apps.cms.services.pages import create_page
    from apps.cms.services.working_drafts import content_etag
    url=endpoint(api);page=create_page(site=api.site,title='Keep me',slug='keep-me',actor=api.user)
    tag=content_etag(page);before=page.revision_number
    payload={'template_id':'blank','version':1,'mode':'replace','page_id':str(page.pk)}
    assignment=UserRoleAssignment.objects.get(user=api.user);assignment.role=Role.objects.get(code='viewer');assignment.save()
    assert api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=tag,**api.header).status_code==403
    assignment.role=Role.objects.get(code='editor');assignment.save()
    foreign=Page.objects.create(site=api.other,title='Foreign',slug='foreign',created_by=api.user,updated_by=api.user)
    forged={**payload,'page_id':str(foreign.pk)}
    assert api.client.post(url+'apply/',forged,content_type='application/json',HTTP_IF_MATCH=content_etag(foreign),**api.header).status_code==404
    invalid={**payload,'template_id':'unregistered'}
    assert api.client.post(url+'apply/',invalid,content_type='application/json',HTTP_IF_MATCH=tag,**api.header).status_code==400
    page.refresh_from_db();assert page.revision_number==before and 'visual_layout' not in page.metadata


def test_apply_rejects_forged_cross_site_media_before_persisting(api,monkeypatch):
    from apps.cms.services.pages import create_page
    from apps.cms.services.working_drafts import content_etag
    from apps.cms.api import homepage_templates as api_templates
    url=endpoint(api);page=create_page(site=api.site,title='Media target',slug='media-target',actor=api.user)
    before=page.revision_number
    template=domain.prepare_template(api.site.pk,'university-main',4,assets=bindings(api))
    image=next(node for node,_ in iter_nodes(template['visual_layout']) if node['type']=='headline')
    image['type']='image';image['props']={'asset_id':'11111111-1111-4111-8111-111111111111','alt':'Foreign media'}
    monkeypatch.setattr(api_templates,'prepare_template',lambda *args,**kwargs:template)
    payload={'template_id':'university-main','version':4,'assets':bindings(api),'mode':'replace','page_id':str(page.pk)}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=content_etag(page),**api.header)
    assert result.status_code==400,result.content
    page.refresh_from_db();assert page.revision_number==before and 'visual_layout' not in page.metadata


@pytest.mark.parametrize('bad',[None,{}, {'required_modules':99}, {'manifest_version':'future'}])
def test_malformed_registry_entries_fail_closed(api,monkeypatch,bad):
    url=endpoint(api);monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    result=api.client.get(url,**api.header)
    assert result.status_code==200,result.content
    assert result.json()[0]['available'] is False and result.json()[0]['layout'] is None


def test_template_image_bindings_reject_foreign_missing_and_failed_images(api):
    url=endpoint(api)
    before=inventory(api)
    missing=api.client.post(url+'prepare/',{'template_id':'university-main','version':4},content_type='application/json',**api.header)
    assert missing.status_code==400
    from tests.test_site_appearance_api import _ready_logo
    foreign=_ready_logo(api.other,api.user)
    assets=bindings(api);assets['hero']['asset_id']=str(foreign.pk)
    rejected=api.client.post(url+'prepare/',{'template_id':'university-main','version':4,'assets':assets},content_type='application/json',**api.header)
    assert rejected.status_code==400
    assert inventory(api)==before
    disable_module_for_site(api.site.pk,Module.objects.get(code='MEDIA').pk)
    catalogue=api.client.get(url,**api.header).json()
    assert not next(entry for entry in catalogue if entry['id']=='university-main')['available']
    assert next(entry for entry in catalogue if entry['id']=='blank')['available']


@pytest.mark.parametrize('template_id',['university-main','college-department'])
def test_illustrated_starter_publishes_to_its_site_and_retains_private_draft_isolation(api,settings,template_id,derivative_storage):
    from apps.cms.tests.test_public_site_hosts import _host,_publish,_enable
    from apps.cms.services.homepage import assign_homepage
    from apps.cms.services.working_drafts import open_working_draft
    settings.ALLOWED_HOSTS=['*']
    url=endpoint(api);ha,hb=_host(api.site),_host(api.other)
    import io,uuid
    from tests.test_media_uploads import png
    from apps.media.uploads import upload_asset
    from apps.media.tasks import process_media_asset
    api.template_image=upload_asset(api.user,api.site.pk,io.BytesIO(png()),filename='approved-campus.png',request_key=uuid.uuid4(),storage=derivative_storage)
    process_media_asset.run(str(api.template_image.pk))
    api.template_image.refresh_from_db()
    assert api.template_image.status=='READY'
    _enable([api.other],'PAGES')
    _publish(Page.objects.create(site=api.other,title='Independent college',slug='independent',is_homepage=True))
    peer_before=api.client.get('/api/v1/site-context/homepage/',HTTP_HOST=hb).json()
    applied=api.client.post(url+'apply/',{'template_id':template_id,'version':4,'assets':bindings(api),'mode':'new','title':'Shared homepage release'},content_type='application/json',HTTP_IDEMPOTENCY_KEY='shared-homepage-release',**api.header)
    assert applied.status_code==201,applied.content
    page=_publish(Page.objects.get(pk=applied.json()['id']))
    assign_homepage(site_id=api.site.pk,page_id=page.pk,actor=api.user)
    public=api.client.get('/api/v1/site-context/homepage/',HTTP_HOST=ha)
    assert public.status_code==200,public.content
    assert public.json()['metadata']['visual_layout']['settings']['content_width']=='full'
    assert any(node['type']=='hero_image' for node,_ in iter_nodes(public.json()['metadata']['visual_layout']))
    assert api.client.get('/api/v1/site-context/homepage/',HTTP_HOST=hb).json()==peer_before
    draft,_=open_working_draft(page,actor=api.user)
    draft.title='Unpublished change';draft.save(update_fields=['title'])
    again=api.client.get('/api/v1/site-context/homepage/',HTTP_HOST=ha)
    assert again.json()['title']=='Shared homepage release'
    assert again.json()['metadata']['visual_layout']==public.json()['metadata']['visual_layout']


def test_homepage_templates_never_include_site_chrome():
    """Branding and menus belong to the global header, not to a starting Page."""
    chrome = {"site_logo", "site_title", "menu"}
    for manifest in domain.MANIFESTS:
        checked = domain.validate_manifest(manifest)
        assert not {node["type"] for node, _ in iter_nodes(checked["layout"])} & chrome

    forged = copy.deepcopy(domain.MANIFESTS[0])
    forged["layout"]["rows"][0]["columns"][0]["children"].append(
        {"id": "legacy-site-title", "type": "site_title", "props": {}},
    )
    with pytest.raises(ValidationError) as caught:
        domain.validate_manifest(forged)
    assert "global header" in str(caught.value)
