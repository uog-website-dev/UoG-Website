"""Withdraw only generated review sources; leave the independent Site untouched."""
import json
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from apps.sites.models import Site, Module
from apps.sites.services.modules import disable_module_for_site
from apps.sites.selectors.modules import module_is_available
from apps.cms.models import Page, Sidebar
from apps.cms.tests.support import transition_with_site_role
from apps.authorization.models import UserRoleAssignment

assert settings.DEBUG
seed = json.loads(Path('/tmp/sidebar-widgets-session.json').read_text())
site = Site.objects.get(pk=seed['site'])
assert site.code.startswith('WIDGETSIDEBAR-')
sidebar = Sidebar.objects.get(site=site)
component = next(row for row in sidebar.components if row['type']=='related_pages')
page = Page.objects.get(pk=component['page_ids'][0], site=site)
actor = get_user_model().objects.create_user(username=seed['run']+'-withdrawal-publisher')
try:
    transition_with_site_role(page,'unpublish',actor)
finally:
    UserRoleAssignment.objects.filter(user=actor).delete()
    get_user_model().objects.filter(pk=actor.pk).update(is_active=False)
disable_module_for_site(site.pk, Module.objects.get(code='POSTS').pk)
assert module_is_available(seed['other'], 'POSTS')
print(json.dumps({'run':seed['run'],'related_source_unpublished':True,'posts_disabled_in_active_site':True,'independent_site_posts_still_enabled':True,'result':'PASS'}))
