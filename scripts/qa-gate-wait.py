"""Wait for real backend readiness before probing persistence after a restart."""
import time
import urllib.error
import urllib.request
from http.client import HTTPException

for attempt in range(30):
    try:
        with urllib.request.urlopen(urllib.request.Request('http://nginx/health/ready', headers={'Host': 'localhost'}), timeout=5) as response:
            if response.status == 200:
                print('Backend readiness HTTP 200')
                break
    except (urllib.error.URLError, TimeoutError, OSError, HTTPException):
        pass
    time.sleep(2)
else:
    raise SystemExit('Backend did not become ready after restart.')
