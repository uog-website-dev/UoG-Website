"""Real-service approval/publication and reusable-region stability evidence."""
import json
from django.core.exceptions import ValidationError
from pathlib import Path
from sprint3_live_review import get_user_model
from apps.cms.models import Page, Sidebar, PublishedContentSnapshot
from apps.cms.services.workflow import transition_content
from apps.cms.services.pages import create_page
from apps.cms.services import sidebars
from apps.cms.tests.support import transition_with_site_role
from apps.authorization.models import UserRoleAssignment
from django.conf import settings

assert settings.DEBUG
session = Path('/tmp/reusable-sidebar-session.json')
seed = json.loads(session.read_text())
editor = get_user_model().objects.get(pk=seed['member_id'])
actors = [get_user_model().objects.create_user(username=seed['run']+'-handoff-'+role) for role in ('reviewer', 'publisher')]
draft = Page.objects.get(pk=seed['draft'], site_id=seed['site'])
assert draft.sidebar_id and draft.sidebar_snapshot['name'] == 'Department sidebar'
original = draft.draft_of
try:
    for action, actor in zip(('submit', 'approve', 'publish'), (editor, *actors)):
        transition_with_site_role(draft, action, actor)
        draft.refresh_from_db()
    original.refresh_from_db()
    snapshot = PublishedContentSnapshot.objects.filter(content=original).latest('version').payload
    second = create_page(site=original.site, title='Shared sidebar second Page', slug='shared-sidebar', layout='RIGHT_SIDEBAR', actor=editor)
    second.sidebar_id = original.sidebar_id
    second.save()
    for action, actor in zip(('submit', 'approve', 'publish'), (editor, *actors)):
        transition_with_site_role(second, action, actor); second.refresh_from_db()
    assert second.sidebar_id == original.sidebar_id
    row = Sidebar.objects.get(pk=original.sidebar_id)
    sidebars.write(site_id=row.site_id, actor=editor, sidebar_id=row.pk, expected=row.version, data={'name': 'Next draft sidebar name'})
    assert PublishedContentSnapshot.objects.filter(content=original).latest('version').payload == snapshot
    try:
        sidebars.remove(site_id=row.site_id, sidebar_id=row.pk, actor=editor, expected=Sidebar.objects.get(pk=row.pk).version)
        raise AssertionError('Referenced sidebar deletion was accepted')
    except ValidationError:
        pass
    print(json.dumps({'run': seed['run'], 'site': seed['site'], 'same_sidebar_id_on_two_pages': True, 'publication_snapshot_frozen': True, 'assigned_deletion_rejected': True, 'separate_review_actors': True, 'result': 'PASS'}))
finally:
    UserRoleAssignment.objects.filter(user__in=actors).delete()
    get_user_model().objects.filter(pk__in=[actor.pk for actor in actors]).update(is_active=False)
