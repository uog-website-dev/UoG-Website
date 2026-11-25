import pytest
from django.db import IntegrityError, transaction
from apps.sites.models import Site, SiteFooter
from tests.test_site_appearance_api import owner, _site_admin_client

pytestmark = pytest.mark.django_db

def test_footer_scoping_validation_and_concurrency(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code='FOOTER-A', name='Site A', organization_unit=owner)
    b = Site.objects.create(code='FOOTER-B', name='Site B', organization_unit=owner)
    actor = _site_admin_client(client, oidc, a)
    url = f'/api/v1/sites/{a.pk}/footer/'
    initial = client.get(url)
    assert initial.status_code == 200, initial.content
    assert not SiteFooter.objects.exists()
    payload = {'description':'University community', 'email':'info@example.org', 'social_links':[{'platform':'youtube','url':'https://www.youtube.com/example'}]}
    saved = client.patch(url, payload, content_type='application/json', HTTP_IF_MATCH=initial['ETag'])
    assert saved.status_code == 200, saved.content
    assert saved.json()['version'] == 1
    assert client.get(url).json()['settings']['description'] == payload['description']
    assert not SiteFooter.objects.filter(site=b).exists()
    assert client.get(f'/api/v1/sites/{b.pk}/footer/').status_code == 403
    assert client.patch(url, {'description':'lost'}, content_type='application/json', HTTP_IF_MATCH=initial['ETag']).status_code == 412
    assert client.patch(url, {'description':'lost'}, content_type='application/json').status_code == 428
    for invalid in ({'site':b.pk}, {'social_links':[{'platform':'x','url':'javascript:alert(1)'}]}, {'highlight_url':'javascript:alert(1)'}, {'copyright_text':'{secret}'}, {'email':'bad'}, {'social_links':[{'platform':'x','url':'https://x.com/a'}]*2}):
        response = client.patch(url, invalid, content_type='application/json', HTTP_IF_MATCH=saved['ETag'])
        assert response.status_code == 400, (invalid, response.content)
    row = SiteFooter.objects.get(site=a)
    assert row.description == payload['description'] and row.updated_by == actor
    from apps.audit.models import AuditEvent
    event = AuditEvent.objects.get(action='SITE_FOOTER_CREATED', entity_id=str(a.pk))
    assert event.actor_id == str(actor.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteFooter.objects.filter(site=a).update(site=b)
    client.defaults.clear()
    assert client.get(url).status_code in (401,403)

def test_public_footer_is_hostname_scoped(client, settings):
    from apps.organizations.models import OrganizationType, OrganizationUnit
    from apps.sites.models import SiteDomain
    from apps.sites.services.lifecycle import activate_site
    kind, _ = OrganizationType.objects.get_or_create(code='UNIVERSITY', defaults={'name':'University'})
    org = OrganizationUnit.objects.create(code='FOOTER-PUBLIC', name='University', organization_type=kind)
    a = Site.objects.create(code='FOOTER-PUB-A', name='Public A', organization_unit=org)
    b = Site.objects.create(code='FOOTER-PUB-B', name='Public B', organization_unit=org)
    for site, host in ((a,'footer-a.uog.edu.et'),(b,'footer-b.uog.edu.et')):
        activate_site(site.pk)
        SiteDomain.objects.create(site=site,hostname=host,is_primary=True,status='ACTIVE')
    from apps.sites.footer import footer_values
    row = SiteFooter.objects.create(site=a, description='Only A footer')
    row.published_settings = footer_values(row)
    row.save(update_fields=['published_settings'])
    settings.ALLOWED_HOSTS = ['*']
    first = client.get('/api/v1/site-context/', HTTP_HOST='footer-a.uog.edu.et')
    second = client.get('/api/v1/site-context/', HTTP_HOST='footer-b.uog.edu.et')
    assert first.status_code == second.status_code == 200
    assert first.json()['configuration']['footer']['description'] == 'Only A footer'
    assert second.json()['configuration']['footer']['description'] == ''
    assert 'no-store' in first['Cache-Control']
    assert client.get('/api/v1/site-context/', HTTP_HOST='unknown-footer.uog.edu.et').status_code == 404


def test_footer_legal_links_accept_empty_and_saved_entries(client,oidc,owner,settings):
    settings.DEBUG=True;settings.ORGANIZATIONS_DEV_WRITES_ENABLED=True
    site=Site.objects.create(code='FOOTER-LEGAL',name='Site',organization_unit=owner)
    _site_admin_client(client,oidc,site)
    url=f'/api/v1/sites/{site.pk}/footer/'
    tag=client.get(url)['ETag']
    empty=client.patch(url,{'legal_links':[]},content_type='application/json',HTTP_IF_MATCH=tag)
    assert empty.status_code==200,empty.content
    assert empty.json()['settings']['legal_links']==[]
    links=[{'label':'Privacy','url':'https://example.org/privacy'},{'label':'Accessibility','url':'https://example.org/accessibility'}]
    saved=client.patch(url,{'legal_links':links},content_type='application/json',HTTP_IF_MATCH=empty['ETag'])
    assert saved.status_code==200,saved.content
    assert saved.json()['settings']['legal_links']==links
    rejected=client.patch(url,{'legal_links':[{'label':'Privacy','url':'javascript:alert(1)'}]},content_type='application/json',HTTP_IF_MATCH=saved['ETag'])
    assert rejected.status_code==400
    assert 'Enter plain text.' not in str(rejected.json())
    assert rejected.json()['error']['details']['legal_links.0.url']==['Use a safe HTTP or HTTPS URL.']

def test_footer_hosted_services_require_safe_https_and_labels(client,oidc,owner,settings):
    settings.DEBUG=True;settings.ORGANIZATIONS_DEV_WRITES_ENABLED=True
    site=Site.objects.create(code='FOOTER-SERVICES',name='Site',organization_unit=owner)
    _site_admin_client(client,oidc,site)
    url=f'/api/v1/sites/{site.pk}/footer/'
    tag=client.get(url)['ETag']
    for invalid in ({'newsletter_url':'javascript:alert(1)','newsletter_label':'Subscribe'},{'newsletter_url':'http://example.org/form','newsletter_label':'Subscribe'},{'support_url':'https://user:secret@example.org','support_label':'Chat'},{'support_url':'https://example.org/help'}):
        response=client.patch(url,invalid,content_type='application/json',HTTP_IF_MATCH=tag)
        assert response.status_code==400,response.content
    saved=client.patch(url,{'newsletter_url':'https://example.org/signup','newsletter_label':'Subscribe','support_url':'https://example.org/support','support_label':'Ask our team'},content_type='application/json',HTTP_IF_MATCH=tag)
    assert saved.status_code==200,saved.content
    assert client.get(url).json()['settings']['newsletter_url']=='https://example.org/signup'
