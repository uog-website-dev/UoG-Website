"""Development rehearsal snapshots contain hashes, never account secrets."""
import json,hashlib
from pathlib import Path
from apps.cms.models import Page,ContentRevision,PublishedContentSnapshot
from apps.sites.models import Site
from django.conf import settings
assert settings.DEBUG
seed=json.loads(Path('/tmp/homepage-template-session.json').read_text())
site_ids=[seed['site'],seed['other']]
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,default=str).encode()).hexdigest()
state={'pages':digest(list(Page.objects.filter(site_id__in=site_ids).order_by('pk').values())),
       'revisions':ContentRevision.objects.filter(content__site_id__in=site_ids).count(),
       'publications':digest(list(PublishedContentSnapshot.objects.filter(content__site_id__in=site_ids).order_by('pk').values())),
       'settings':digest(list(Site.objects.filter(pk__in=site_ids).order_by('pk').values('id','homepage_id','configuration'))),
       'other_pages':digest(list(Page.objects.filter(site_id=seed['other']).order_by('pk').values()))}
p=Path('/tmp/homepage-template-baseline.json')
if QA_STAGE=='baseline':p.write_text(json.dumps(state))
else:
 before=json.loads(p.read_text())
 if QA_STAGE=='preview':assert state==before,'Preview mutated CMS data'
 else:
  assert state['publications']==before['publications'] and state['settings']==before['settings'] and state['other_pages']==before['other_pages']
  page=Page.objects.get(pk=seed['page_id']);assert len(page.metadata['visual_layout']['rows'])==5
print(json.dumps({'stage':QA_STAGE,'result':'PASS','revisions':state['revisions']}))
