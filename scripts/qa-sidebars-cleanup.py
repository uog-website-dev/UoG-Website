"""Retire only generated layout-review identities; retain audited content evidence."""
import json
import sys
from pathlib import Path
from sprint3_live_review import Review, get_user_model
from apps.authorization.models import UserRoleAssignment
from django.conf import settings
from django.utils import timezone

assert settings.DEBUG
session = Path('/tmp/reusable-sidebar-session.json')
seed = json.loads(session.read_text())
config = json.load(sys.stdin)
review = Review.__new__(Review)
review.config = lambda key, default=None: config.get(key, default)
token = review.token(config['KC_ADMIN_USERNAME'], config['KC_ADMIN_PASSWORD'], client='admin-cli', realm='master')
for subject in seed['kc_users']:
    assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+subject, token=token, body={'enabled': False})[0] == 204
UserRoleAssignment.objects.filter(user_id=seed['member_id'], revoked_at=None).update(revoked_at=timezone.now())
get_user_model().objects.filter(pk=seed['member_id']).update(is_active=False)
session.unlink()
print(json.dumps({'run': seed['run'], 'generated_accounts_disabled': len(seed['kc_users']), 'memberships_revoked': True, 'private_session_removed': True}))
