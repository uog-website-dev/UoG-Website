"""Refresh disposable API test credentials; stdout is private browser-driver stdin."""
import json,sys
from pathlib import Path
from django.conf import settings
assert settings.DEBUG
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
config=json.load(sys.stdin);p=Path('/tmp/college-workflow-session.json');data=json.loads(p.read_text())
r=Review.__new__(Review);r.config=lambda key,default=None:config.get(key,default)
for profile in data['profiles'].values():profile['token']=r.token(profile['username'],profile['password'])
p.write_text(json.dumps(data));p.chmod(0o600)
print(json.dumps(data))
