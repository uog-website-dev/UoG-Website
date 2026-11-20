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
from .test_menu_api import api, ready
pytestmark = pytest.mark.django_db


def endpoint(api):
    for code in ('PAGES','VISUAL_BUILDER'):
        module=Module.objects.get(code=code)
        if not module.is_enabled:
            module.is_enabled=True;module.save(update_fields=['is_enabled'])
        enable_module_for_site(api.site.pk,module.pk)
    return f'/api/v1/sites/{api.site.pk}/homepage-templates/'


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
        prepared=api.client.post(url+'prepare/',{'template_id':entry['id'],'version':entry['version']},content_type='application/json',**api.header)
        assert prepared.status_code==200,prepared.content
        result=prepared.json()['visual_layout'];validate_layout(result)
        assert result['rows']==[] if entry['id']=='blank' else result['rows']
        again=domain.prepare_template(api.site.pk,entry['id'],entry['version'])['visual_layout']
        ids={node['id'] for node,_ in iter_nodes(result)}
        assert not ids & {node['id'] for node,_ in iter_nodes(again)}
    assert inventory(api)==before


def test_starter_manifests_use_site_bound_widgets_and_editable_sections(api):
    endpoint(api)
    for template_id in ('university-main','college-department'):
        prepared=domain.prepare_template(api.site.pk,template_id,3)['visual_layout']
        kinds={node['type'] for node,_ in iter_nodes(prepared)}
        assert {'site_logo','site_title','menu','headline','editor','button_grid','loop_grid'} <= kinds
        news=[node for node,_ in iter_nodes(prepared) if node['type']=='loop_grid']
        assert len(news)==1 and news[0]['props']['source']=='posts'
        assert all('asset_id' not in node.get('props',{}) and 'url' not in node.get('props',{}) for node,_ in iter_nodes(prepared))


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
    assert api.client.post(url+'prepare/',{'template_id':bad['id'],'version':3},content_type='application/json',**api.header).status_code==400


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
    for code in ('PAGES','VISUAL_BUILDER'):enable_module_for_site(api.other.pk,Module.objects.get(code=code).pk)
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
    prepared=domain.prepare_template(api.site.pk,'university-main',3)['visual_layout']
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
    payload={'template_id':'university-main','version':3,'mode':'new','title':'New Main Draft'}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IDEMPOTENCY_KEY='apply-main-001',**api.header)
    assert result.status_code==201,result.content
    data=result.json();page=Page.objects.get(pk=data['id'])
    assert page.status=='DRAFT' and page.is_homepage is False
    assert [node['type'] for node,_ in iter_nodes(page.metadata['visual_layout'])]==[node['type'] for node,_ in iter_nodes(domain.prepare_template(api.site.pk,'university-main',3)['visual_layout'])]
    assert page.metadata['template_application']=={'id':'university-main','version':3,'idempotency_key':'apply-main-001'}
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
    payload={'template_id':'college-department','version':3,'mode':'replace','page_id':str(page.pk)}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=content_etag(page),**api.header)
    assert result.status_code==200,result.content
    page.refresh_from_db()
    assert page.revision_number==before+1
    assert page.metadata['template_application']=={'id':'college-department','version':3}
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
    template=domain.prepare_template(api.site.pk,'university-main',3)
    image=next(node for node,_ in iter_nodes(template['visual_layout']) if node['type']=='headline')
    image['type']='image';image['props']={'asset_id':'11111111-1111-4111-8111-111111111111','alt':'Foreign media'}
    monkeypatch.setattr(api_templates,'prepare_template',lambda *args:template)
    payload={'template_id':'university-main','version':3,'mode':'replace','page_id':str(page.pk)}
    result=api.client.post(url+'apply/',payload,content_type='application/json',HTTP_IF_MATCH=content_etag(page),**api.header)
    assert result.status_code==400,result.content
    page.refresh_from_db();assert page.revision_number==before and 'visual_layout' not in page.metadata


@pytest.mark.parametrize('bad',[None,{}, {'required_modules':99}, {'manifest_version':'future'}])
def test_malformed_registry_entries_fail_closed(api,monkeypatch,bad):
    url=endpoint(api);monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    result=api.client.get(url,**api.header)
    assert result.status_code==200,result.content
    assert result.json()[0]['available'] is False and result.json()[0]['layout'] is None
