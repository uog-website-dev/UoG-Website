"""Verify retained upgraded-environment records with the approved development admin."""
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from http.client import HTTPException

inputs = json.loads(sys.stdin.read())
state, env = inputs['state'], inputs['kc']
for attempt in range(30):
    try:
        with urllib.request.urlopen(urllib.request.Request('http://nginx/health/ready', headers={'Host': 'localhost'}), timeout=5) as response:
            if response.status == 200:
                break
    except (urllib.error.URLError, TimeoutError, OSError, HTTPException):
        time.sleep(2)
else:
    raise RuntimeError('Backend did not become ready after restoration.')
form = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'backend-api',
    'client_secret': env['KEYCLOAK_BACKEND_API_SECRET'], 'username': env['KEYCLOAK_DEV_USERNAME'],
    'password': env['KEYCLOAK_DEV_PASSWORD'], 'scope': 'openid profile email'}).encode()
for attempt in range(45):
    try:
        with urllib.request.urlopen(urllib.request.Request('http://keycloak:8080/realms/uog/protocol/openid-connect/token', data=form), timeout=10) as response:
            token = json.loads(response.read())['access_token']
            break
    except (urllib.error.URLError, TimeoutError, OSError, HTTPException):
        time.sleep(2)
else:
    raise RuntimeError('Keycloak did not become ready after restoration.')
def get(path):
    with urllib.request.urlopen(urllib.request.Request('http://nginx' + path,
            headers={'Authorization': 'Bearer ' + token, 'Host': 'localhost'}), timeout=30) as response:
        return json.loads(response.read())
organization = get(f"/api/v1/organizations/{state['objects']['organization_id']}/")
assert organization['code'] == state['run'].upper()
for site in state['sites']:
    actual = get(site['url'])
    assert actual['code'] == site['code'] and actual['organization_unit'] == site['owner']
print(json.dumps({'test_id': 'T05', 'status': 'PASS', 'run': state['run'], 'date': state['date'],
    'build': state['build'], 'actual': 'Organization code and both Site codes/owners retrieved through authenticated HTTP after application/container restart and isolated fresh-stack deployment. Used existing approved development administrator; no grants or model fields were changed.'}))
