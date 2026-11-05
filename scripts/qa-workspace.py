"""Local real-Keycloak workspace QA. Private credentials travel only on stdin/tmp."""
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, '/app')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from django.conf import settings

assert settings.DEBUG, 'Dedicated identity setup is restricted to local development.'
inputs = json.loads(sys.stdin.read())
env = inputs['kc']
private = Path('/tmp/workspace-qa-session.json')
result = Path('/tmp/workspace-qa-results.json')
trace = Path('/tmp/workspace-qa-http.json')
actors, events = {}, []
state = {'run': 'qaws' + uuid.uuid4().hex[:8], 'build': inputs['build'], 'date': '2026-11-04'}

def save():
    result.write_text(json.dumps(state, indent=2))
    trace.write_text(json.dumps(events, indent=2))
    private.write_text(json.dumps({'run': state['run'], 'actors': actors}))
    private.chmod(0o600)

def http(url, method='GET', body=None, token=None, form=None, host=None):
    headers = {'Content-Type': 'application/x-www-form-urlencoded' if form is not None else 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if url.startswith('http://nginx'): headers['Host'] = 'localhost'
    if host: headers['Host'] = host
    payload = urllib.parse.urlencode(form).encode() if form is not None else json.dumps(body).encode() if body is not None else None
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, data=payload, headers=headers, method=method), timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read().decode()
    try: value = json.loads(raw) if raw else None
    except ValueError: value = {'non_json': raw[:150]}
    return response.status, value, dict(response.headers)

def token(username, password, client='backend-api'):
    form = {'grant_type': 'password', 'client_id': client, 'username': username, 'password': password,
            'scope': 'openid profile email'}
    if client == 'backend-api': form['client_secret'] = env['KEYCLOAK_BACKEND_API_SECRET']
    response = http('http://keycloak:8080/realms/' + ('master' if client == 'admin-cli' else 'uog') + '/protocol/openid-connect/token', 'POST', form=form)
    assert response[0] == 200, 'QA token issuance failed.'
    return response[1]['access_token']

def api(path, method='GET', body=None, actor='platform', expected=(200, 201)):
    response = http('http://nginx' + path, method, body, actors[actor]['access_token'])
    events.append({'path': path, 'method': method, 'actor': actors[actor]['username'], 'status': response[0],
                   'body': body, 'response': response[1], 'request_id': response[2].get('X-Request-ID')})
    save()
    assert response[0] in expected, f'{method} {path}: HTTP {response[0]}'
    return response[1]

def rows(value):
    return value.get('results', []) if isinstance(value, dict) else value

phase = sys.argv[1]
if phase != 'setup':
    state = json.loads(result.read_text())
    actors = json.loads(private.read_text())['actors']
    events = json.loads(trace.read_text())

try:
    if phase == 'setup':
        assert not private.exists(), 'Clean up the previous dedicated QA session first.'
        master = token(env['KC_BOOTSTRAP_ADMIN_USERNAME'], env['KC_BOOTSTRAP_ADMIN_PASSWORD'], 'admin-cli')
        actors['bootstrap'] = {'username': env['KEYCLOAK_DEV_USERNAME'],
            'access_token': token(env['KEYCLOAK_DEV_USERNAME'], env['KEYCLOAK_DEV_PASSWORD'])}
        for name in ('platform', 'siteadmin', 'reviewer', 'publisher'):
            username, password = state['run'] + '-' + name, secrets.token_urlsafe(24)
            response = http('http://keycloak:8080/admin/realms/uog/users', 'POST', {
                'username': username, 'enabled': True, 'emailVerified': True, 'email': username + '@example.invalid',
                'firstName': 'QA', 'lastName': name, 'requiredActions': [],
                'credentials': [{'type': 'password', 'value': password, 'temporary': False}],
            }, master)
            assert response[0] == 201
            actors[name] = {'username': username, 'password': password,
                'kc_id': response[2]['Location'].rsplit('/', 1)[-1], 'access_token': token(username, password)}
            save()
            api('/api/me/', actor=name)
            # /api/me/ provisions the real OIDC identity. Read its local key for
            # the assignment API; no user/grant is inserted through the ORM.
            from django.contrib.auth import get_user_model
            actors[name]['user_id'] = get_user_model().objects.get(username=username).pk
            save()
        roles = {row['code']: row['id'] for row in rows(api('/api/v1/authorization/roles/', actor='bootstrap'))}
        api('/api/v1/authorization/assignments/', 'POST', {'user': actors['platform']['user_id'],
            'role': roles['platform-administrator'], 'scope': 'PLATFORM'}, 'bootstrap')
        del actors['bootstrap']
        site = api('/api/v1/sites/12/')
        other = api('/api/v1/sites/13/')
        assert site['code'].startswith('QA') and other['code'].startswith('QA'), 'Use retained synthetic QA Sites only.'
        state.update(site=site, other=other, title='Workspace QA ' + state['run'], slug='workspace-' + state['run'])
        for name, role in (('siteadmin', 'site-administrator'), ('reviewer', 'reviewer'), ('publisher', 'publisher')):
            api('/api/v1/authorization/assignments/', 'POST', {'user': actors[name]['user_id'], 'role': roles[role],
                'scope': 'SITE', 'site': site['id'], 'organization': site['organization_unit']})
            api(f"/api/v1/cms/sites/{site['id']}/content-roles/", 'POST', {'user_id': actors[name]['user_id'],
                'role': {'siteadmin': 'AUTHOR', 'reviewer': 'REVIEWER', 'publisher': 'PUBLISHER'}[name]})
        available = rows(api(f"/api/v1/sites/{site['id']}/modules/", actor='siteadmin'))
        state['modules'] = available
        assert all('is_available' in row for row in available)
        state['expected_page_counts'] = {status: api(f"/api/v1/sites/{site['id']}/pages/?status={status}&page_size=1", actor='siteadmin')['count']
            for status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')}
        menus = rows(api(f"/api/v1/sites/{site['id']}/menus/", actor='siteadmin'))
        state['expected_menus'] = {'Local menus': len(menus), 'Active': sum(row['is_active'] for row in menus),
            'Menu items': sum(len(api(f"/api/v1/sites/{site['id']}/menus/{row['id']}/tree/", actor='siteadmin')['items']) for row in menus)}
        denied = api(f"/api/v1/sites/{other['id']}/pages/", actor='siteadmin', expected=(403, 404))
        state['cross_site_denied'] = True
        save()
        print(json.dumps({'phase': phase, 'run': state['run'], 'site': site['id'], 'foreign_site': other['id'], 'cross_site': 'DENIED'}))
    elif phase == 'finish':
        for actor in actors.values(): actor['access_token'] = token(actor['username'], actor['password'])
        site = state['site']
        pages = rows(api(f"/api/v1/sites/{site['id']}/pages/?search={state['slug']}", actor='siteadmin'))
        page = next(row for row in pages if row['slug'] == state['slug'])
        workflow = f"/api/v1/cms/sites/{site['id']}/content/{page['id']}/workflow/"
        for action, actor in (('submit', 'siteadmin'), ('approve', 'reviewer'), ('publish', 'publisher')):
            api(workflow, 'POST', {'action': action}, actor)
        state['workflow'] = 'PASS — browser-created Page submitted, approved and published by distinct authorized users'
        state['page_id'] = page['id']
        domains = rows(api(f"/api/v1/sites/{site['id']}/domains/"))
        host = next(row['hostname'] for row in domains if row['is_primary'] and row['status'] == 'ACTIVE')
        public_path = '/api/v1/site-context/pages/' + state['slug'] + '/'
        delivered = http('http://nginx' + public_path, host=host)
        assert delivered[0] == 200 and delivered[1]['id'] == page['id']
        events.append({'path': public_path, 'host': host, 'status': delivered[0], 'response': delivered[1]})
        state['public_delivery'] = 'PASS — published browser-created Page delivered under its owning hostname'
        save()
        print(json.dumps({'phase': phase, 'workflow': state['workflow']}))
    elif phase == 'cleanup':
        from django.contrib.auth import get_user_model
        from django.db import transaction
        from django.utils import timezone
        from apps.authorization.models import UserRoleAssignment
        from apps.cms.models import SiteContentRoleAssignment
        from apps.audit.context import audit_context
        from apps.audit.writer import record_event
        master = token(env['KC_BOOTSTRAP_ADMIN_USERNAME'], env['KC_BOOTSTRAP_ADMIN_PASSWORD'], 'admin-cli')
        owned = [actor for actor in actors.values() if actor.get('kc_id')]
        for actor in owned:
            assert actor['username'].startswith(state['run'] + '-')
            assert http('http://keycloak:8080/admin/realms/uog/users/' + actor['kc_id'], 'PUT', {'enabled': False}, master)[0] == 204
            assert http('http://keycloak:8080/admin/realms/uog/users/' + actor['kc_id'] + '/logout', 'POST', {}, master)[0] == 204
        ids = list(get_user_model().objects.filter(username__in=[actor['username'] for actor in owned]).values_list('pk', flat=True))
        with transaction.atomic(), audit_context(actor_id='workspace-qa-cleanup'):
            grants = UserRoleAssignment.objects.filter(user_id__in=ids, revoked_at=None).update(revoked_at=timezone.now())
            bindings = SiteContentRoleAssignment.objects.filter(user_id__in=ids).delete()[0]
            get_user_model().objects.filter(pk__in=ids).update(is_active=False)
            record_event(action='QA_IDENTITIES_DISABLED', entity_type='qa.run', entity_id=state['run'], after={'identities': len(owned), 'grants_revoked': grants})
        private.unlink()
        state['cleanup'] = {'disabled_accounts': len(owned), 'revoked_grants': grants, 'removed_cms_bindings': bindings,
            'private_session_removed': True, 'module_switches_changed': False, 'developer_volumes_changed': False}
        result.write_text(json.dumps(state, indent=2))
        print(json.dumps(state['cleanup']))
    else:
        raise RuntimeError('Unknown QA phase.')
except Exception as error:
    state['error'] = type(error).__name__ + ': ' + str(error)[:200]
    save()
    print('Workspace QA stopped: ' + state['error'])
    raise SystemExit(1)
