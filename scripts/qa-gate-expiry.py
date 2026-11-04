"""Probe expiration of an actual QA token without persisting the token in evidence."""
import base64
import json
import time
import sys
import urllib.error
import urllib.request
from pathlib import Path

session = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa-gate-session.json').read_text())
token = session['actors']['viewer']['access_token']
claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '==='))
wait = max(0, claims['exp'] - time.time() + 40)
time.sleep(wait)
request = urllib.request.Request('http://nginx/api/me/', headers={
    'Authorization': 'Bearer ' + token, 'Host': 'localhost',
})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
except urllib.error.HTTPError as error:
    status = error.code
result = {'run': session['run'], 'status': 'PASS' if status == 401 else 'FAIL',
          'http_status': status, 'waited_seconds': round(wait, 1),
          'margin_after_exp_seconds': 40, 'tested_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
Path('/tmp/qa-expiry.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
raise SystemExit(0 if status == 401 else 1)
