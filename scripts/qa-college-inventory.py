import json
from django.apps import apps
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.contrib.auth import get_user_model
from apps.sites.models import Site
from apps.cms.models import SiteContent,ContentWorkflowTransition,PublishedContentSnapshot,Page
from apps.cms.menu_assignment_models import MenuLocationAssignment
from apps.media.models import MediaAsset
from apps.authorization.models import UserRoleAssignment
from apps.audit.models import AuditEvent
from pathlib import Path
data=json.loads(Path('/tmp/college-workflow-session.json').read_text())
s=Site.objects.get(pk=data['site'],is_main=False);prefix='College review '+data['run']
from apps.api.models import Post
pages=Page.objects.filter(site=s,title__startswith=prefix)
posts=Post.objects.filter(site=s,title__startswith=prefix)
ids=list(pages.values_list('pk',flat=True))+list(posts.values_list('pk',flat=True))
content=SiteContent.objects.filter(pk__in=ids)
users=get_user_model().objects.filter(username__startswith='s3-'+data['run']+'-')
loader=MigrationLoader(connection)
result={'site':{'id':s.pk,'code':s.code,'status':s.status,'hostname':s.domains.get(is_primary=True,status='ACTIVE').hostname,'homepage_id':str(s.homepage_id)},'modules':list(s.site_modules.filter(is_enabled=True).values_list('module__code',flat=True)),'content':list(pages.values('id','title','slug','status'))+list(posts.values('id','title','slug','status')),'pages':list(Page.objects.filter(pk__in=ids).values('id','layout','sidebar_id','draft_of_id')),'published_snapshots':list(PublishedContentSnapshot.objects.filter(content_id__in=ids).values('content_id','version','approved_revision_id','published_at')),'workflow':list(ContentWorkflowTransition.objects.filter(content_id__in=ids).values('content_id','from_status','to_status','actor_id','revision_id','reviewed_revision_id')),'assignments':list(MenuLocationAssignment.objects.filter(site=s).values('location','is_published','draft_menu_id','published_menu_id')),'media':list(MediaAsset.objects.filter(site=s,original_filename=data['run']+'-campus.png').values('id','site_id','status','detected_mime','byte_count')),'roles':list(UserRoleAssignment.objects.filter(user__in=users).values('user_id','role__code','scope','site_id','revoked_at')),'audit':list(AuditEvent.objects.filter(actor_id__in=[str(i) for i in users.values_list('pk',flat=True)]).values('action','entity_type','entity_id','actor_id','request_id')),'migrations':{'leaves':loader.graph.leaf_nodes(),'unapplied_leaves':[x for x in loader.graph.leaf_nodes() if x not in loader.applied_migrations]}}
print(json.dumps(result,default=str,indent=2))
