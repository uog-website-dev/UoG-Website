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
    prepared=domain.prepare_template(api.site.pk,'university-main',1)['visual_layout']
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


@pytest.mark.parametrize('bad',[None,{}, {'required_modules':99}, {'manifest_version':'future'}])
def test_malformed_registry_entries_fail_closed(api,monkeypatch,bad):
    url=endpoint(api);monkeypatch.setattr(domain,'MANIFESTS',(bad,))
    result=api.client.get(url,**api.header)
    assert result.status_code==200,result.content
    assert result.json()[0]['available'] is False and result.json()[0]['layout'] is None
