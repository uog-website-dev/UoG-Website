"""Disable only rehearsal identities and remove its private credential file."""
import json
from pathlib import Path
from sprint3_live_review import get_user_model
from apps.accounts.site_provisioning import KeycloakAccounts
from apps.accounts.models import AccountProfile,OIDCIdentity
from apps.authorization.models import UserRoleAssignment
from django.conf import settings
from django.utils import timezone
assert settings.DEBUG
p=Path('/tmp/site-user-browser-session.json');seed=json.loads(p.read_text())
client=KeycloakAccounts()
# Include the browser-created account even if verification was interrupted.
from django.db.models import Q
users=get_user_model().objects.filter(Q(pk__in=seed['users'])|Q(username__in=[seed['admin']['username'],seed['staff']['username'],seed['run']+'-main']))
ids=list(users.values_list('pk',flat=True))
subjects=list(OIDCIdentity.objects.filter(user_id__in=ids).values_list('subject',flat=True))
for subject in subjects:
    with client.call('PUT',f'/{subject}',{'enabled':False}):
        pass
users.update(is_active=False)
AccountProfile.objects.filter(user_id__in=ids).update(state='FAILED')
UserRoleAssignment.objects.filter(user_id__in=ids,revoked_at__isnull=True).update(revoked_at=timezone.now())
p.unlink()
print(json.dumps({'run':seed['run'],'accounts_disabled':len(subjects),'memberships_revoked':True,'private_session_removed':True}))
