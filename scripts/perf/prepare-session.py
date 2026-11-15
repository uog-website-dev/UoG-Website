"""Pipe directly to the benchmark. Output contains credentials; never tee to evidence."""
import json,sys
from pathlib import Path
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
config=json.load(sys.stdin);data=json.loads(Path('/tmp/perf001-session.json').read_text())
review=Review.__new__(Review);review.config=lambda key,default=None:config.get(key,default)
data['actor']['token']=review.token(data['actor']['username'],data['actor']['password'])
print(json.dumps(data))
