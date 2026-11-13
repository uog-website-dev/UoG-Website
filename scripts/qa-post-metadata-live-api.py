"""Create isolated real-service metadata fixtures and exercise API boundaries."""
import json
import sys
import uuid
from pathlib import Path

from django.conf import settings
from sprint3_live_review import (
    Review, Site, SiteDomain, Module, OrganizationUnit, OrganizationType,
    ContentRole, enable_module_for_site, disable_module_for_site, activate_site,
)
from apps.api.models import Category, Tag
from apps.cms.models import ContentRevision

assert settings.DEBUG
config = json.load(sys.stdin)
session_path = Path('/tmp/post-editor-browser-session.json')
seed = json.loads(session_path.read_text())
review = Review.__new__(Review)
review.run = seed['run']
review.users = seed['users']
review.profiles = seed['profiles']
review.rows = []
review.seed = {'profiles': {}}
review.config = lambda key, default=None: config.get(key, default)
review.kc_admin = review.token(config['KC_ADMIN_USERNAME'], config['KC_ADMIN_PASSWORD'], client='admin-cli', realm='master')
a = Site.objects.get(pk=seed['site'])
module = Module.objects.get(code='POSTS')

def persist():
    seed.update(users=review.users, profiles=review.profiles)
    session_path.write_text(json.dumps(seed))
    session_path.chmod(0o600)

def etag(response):
    return next(value for key, value in response[1].items() if key.lower() == 'etag')

try:
    organization = OrganizationUnit.objects.create(
        code='META-' + uuid.uuid4().hex[:12], name='Metadata review Site B',
        organization_type=OrganizationType.objects.get(code='COLLEGE'), parent=a.organization_unit.parent,
    )
    b = Site.objects.create(code=organization.code, name='Metadata review Site B', organization_unit=organization)
    enable_module_for_site(b.pk, module.pk)
    activate_site(b.pk)
    for name, role, site, cms_role in [
        ('reader', 'viewer', a, None),
        ('reviewer', 'reviewer', a, ContentRole.REVIEWER),
        ('publisher', 'publisher', a, ContentRole.PUBLISHER),
        ('editor-b', 'editor', b, ContentRole.AUTHOR),
    ]:
        try:
            review.provision(name, role, site, cms_role)
        finally:
            persist()
    for index in range(100):
        Category.objects.create(site=a, code=f'META_{index:03}', name=f'Category {index:03}')
    category = Category.objects.create(site=a, code='META_LAST', name='Zoology Research')
    tag = Tag.objects.create(site=a, code='META_CAMPUS', name='Campus')
    inactive = Category.objects.create(site=a, code='META_INACTIVE', name='Inactive category', is_active=False)
    foreign_category = Category.objects.create(site=b, code='META_LAST', name='Zoology Research')
    foreign_tag = Tag.objects.create(site=b, code='META_CAMPUS', name='Campus')
    host_a = 'meta-' + review.run + '-a.uog.local'
    host_b = 'meta-' + review.run + '-b.uog.local'
    for site, host in [(a, host_a), (b, host_b)]:
        SiteDomain.objects.create(site=site, hostname=host, is_primary=True, status='ACTIVE')
    base = f'/api/v1/sites/{a.pk}/posts/'
    payload = {
        'title': 'Published metadata review', 'slug': 'published-' + review.run,
        'excerpt': 'Approved university summary', 'content': 'Approved body',
        'categories': [str(category.pk)], 'tags': [str(tag.pk)],
    }
    created = review.api('POST', base, 'author', body=payload)
    post = review.expect('Create complete metadata', created, 201)
    detail = base + post['id'] + '/'
    revision = ContentRevision.objects.get(content_id=post['id'], revision_number=post['revision_number'])
    review.check('Complete taxonomy in revision', revision.snapshot['categories'] == payload['categories'] and revision.snapshot['tags'] == payload['tags'])
    for label, fields, actor, expected in [
        ('Foreign category denied', {'categories': [str(foreign_category.pk)]}, 'author', 400),
        ('Foreign tag denied', {'tags': [str(foreign_tag.pk)]}, 'author', 400),
        ('Inactive category denied', {'categories': [str(inactive.pk)]}, 'author', 400),
        ('Reserved permalink denied', {'slug': 'admin'}, 'author', 400),
        ('Invalid permalink denied', {'slug': 'bad/path'}, 'author', 400),
        ('Title length enforced', {'title': 'x' * 256}, 'author', 400),
        ('Viewer metadata update denied', {'excerpt': 'Denied'}, 'reader', 403),
    ]:
        response = review.api('PATCH', detail, actor, body=fields, headers={'If-Match': etag(created)})
        review.expect(label, response, expected)
    duplicate = review.api('POST', base, 'author', body=payload)
    error = review.expect('Duplicate Site slug denied', duplicate, 400)
    review.check('Duplicate has slug field error', 'slug' in error['error']['details'])
    twin = review.api('POST', f'/api/v1/sites/{b.pk}/posts/', 'editor-b', body={**payload, 'categories': [str(foreign_category.pk)], 'tags': [str(foreign_tag.pk)]})
    twin_post = review.expect('Same slug accepted in independent hostname namespace', twin, 201)
    review.expect('Foreign Post read denied', review.api('GET', base + twin_post['id'] + '/', 'author'), 404)
    review.expect('Foreign Site metadata update denied', review.api('PATCH', f'/api/v1/sites/{b.pk}/posts/{twin_post["id"]}/', 'author', body={'title': 'Denied'}, headers={'If-Match': etag(twin)}), 403)
    try:
        disable_module_for_site(a.pk, module.pk)
        review.expect('Disabled module blocks metadata update', review.api('PATCH', detail, 'author', body={'excerpt': 'Denied'}, headers={'If-Match': etag(created)}), 400)
    finally:
        enable_module_for_site(a.pk, module.pk)
    current = review.api('GET', detail, 'author')
    unchanged = review.expect('Rejected updates retain metadata', current, 200)
    review.check('Identity and summary intact', unchanged['title'] == payload['title'] and unchanged['excerpt'] == payload['excerpt'] and unchanged['slug'] == payload['slug'])
    workflow = f'/api/v1/cms/sites/{a.pk}/content/{post["id"]}/workflow/'
    for action, actor in [('submit', 'author'), ('approve', 'reviewer'), ('publish', 'publisher')]:
        review.expect('Existing metadata workflow ' + action, review.api('POST', workflow, actor, body={'action': action}), 200)
    public = review.expect('Published metadata is public', review.api('GET', '/api/v1/site-context/posts/' + payload['slug'] + '/', host=host_a), 200)
    review.check('Published summary and taxonomy readable', public['excerpt'] == payload['excerpt'] and public['categories'][0]['name'] == category.name and public['tags'][0]['name'] == tag.name)
    review.expect('Independent hostname draft remains private', review.api('GET', '/api/v1/site-context/posts/' + payload['slug'] + '/', host=host_b), 404)
    seed['metadata'] = {
        'site_b': b.pk, 'host_a': host_a, 'host_b': host_b,
        'category': str(category.pk), 'tag': str(tag.pk), 'category_name': category.name,
        'published_slug': payload['slug'], 'published_title': payload['title'],
    }
finally:
    persist()
    Path('/tmp/post-metadata-live-api.json').write_text(json.dumps({'run': review.run, 'site_a': a.pk, 'fixtures': seed.get('metadata'), 'results': review.rows}, indent=2))
print(json.dumps({'checks': len(review.rows), 'passed': sum(row['status'] == 'PASS' for row in review.rows)}))
