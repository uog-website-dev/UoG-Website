"""Local-only Page layout browser fixtures. Credentials remain in /tmp."""
import json
import sys
import uuid
from pathlib import Path

from sprint3_live_review import (
    Review, Site, SiteDomain, OrganizationUnit, OrganizationType, Module,
    enable_module_for_site, activate_site, get_user_model,
)
from apps.sites.services.domains import activate_domain
from apps.cms.services.pages import create_page
from apps.cms.services.working_drafts import open_working_draft
from apps.cms.tests.support import transition_with_site_role
from apps.cms.tests.test_page_shell_layouts import TREE
from django.conf import settings

assert settings.DEBUG
session = Path('/tmp/page-layout-session.json')
assert not session.exists(), 'Clean up the previous rehearsal first.'
config = json.load(sys.stdin)
review = Review.__new__(Review)
review.rows, review.users, review.profiles = [], [], {}
review.seed = {'profiles': {}}
review.run = 'layout-' + uuid.uuid4().hex[:10]
review.config = lambda key, default=None: config.get(key, default)
review.kc_admin = review.token(config['KC_ADMIN_USERNAME'], config['KC_ADMIN_PASSWORD'], client='admin-cli', realm='master')
root = OrganizationUnit.objects.filter(parent__isnull=True, organization_type__code='UNIVERSITY').first()
owner = OrganizationUnit.objects.create(code=review.run.upper(), name='Page layout QA', organization_type=OrganizationType.objects.get(code='COLLEGE'), parent=root)
# Retire identities from an interrupted rehearsal before creating a new run.
for old in get_user_model().objects.filter(username__startswith='s3-layout-', is_active=True):
    status, _, matches, _ = review.http('GET', 'http://keycloak:8080/admin/realms/uog/users?username='+old.username+'&exact=true', token=review.kc_admin)
    for match in matches or []:
        assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+match['id'], token=review.kc_admin, body={'enabled': False})[0] == 204
    old.is_active = False
    old.save(update_fields=['is_active'])
sites = []
for suffix in ('a', 'b'):
    site = Site.objects.create(code=review.run.upper()+suffix.upper(), name='Layout Site '+suffix.upper(), organization_unit=owner)
    activate_site(site.pk)
    domain = SiteDomain.objects.create(site=site, hostname=review.run+suffix+'.uog.local', is_primary=True)
    activate_domain(domain.pk)
    for code in ('PAGES', 'VISUAL_BUILDER'):
        enable_module_for_site(site.pk, Module.objects.get(code=code).pk)
    sites.append(site)
editor = review.provision('editor', 'editor', sites[0])
reviewers = [get_user_model().objects.create_user(username=review.run+'-'+role) for role in ('reviewer', 'publisher')]
pages = {}
for site in sites:
    for layout in (('FULL_WIDTH', 'LEFT_SIDEBAR', 'RIGHT_SIDEBAR') if site == sites[0] else ('FULL_WIDTH',)):
        page = create_page(site=site, title='University '+layout.replace('_', ' ').title(), slug=layout.lower().replace('_', '-'), layout=layout, metadata={'visual_layout': TREE}, actor=editor)
        for action, actor in zip(('submit', 'approve', 'publish'), (editor, *reviewers)):
            transition_with_site_role(page, action, actor)
            page.refresh_from_db()
        pages[str(site.pk)+':'+layout] = str(page.pk)
        if site == sites[0] and layout == 'FULL_WIDTH':
            draft, _ = open_working_draft(page, actor=editor)
draft_id = str(draft.pk)
from apps.authorization.models import UserRoleAssignment
UserRoleAssignment.objects.filter(user__in=reviewers).delete()
get_user_model().objects.filter(pk__in=[user.pk for user in reviewers]).update(is_active=False)
data = {'run': review.run, 'site': sites[0].pk, 'other': sites[1].pk, 'host': review.run+'a.uog.local', 'other_host': review.run+'b.uog.local', 'draft': draft_id, 'member': review.profiles['editor'], 'member_id': editor.pk, 'kc_users': review.users, 'pages': pages}
session.write_text(json.dumps(data))
session.chmod(0o600)
print(json.dumps({'run': review.run, 'sites': [site.pk for site in sites], 'published_pages': len(pages)}))
