"""Import a bounded, downloaded AAU reference fixture into an isolated development Site."""
import hashlib,json,time,uuid
from pathlib import Path
from html import escape
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand,CommandError
from apps.audit.context import audit_context
from apps.sites.models import Site,SiteFooter
from apps.sites.services.configuration import apply_site_configuration
from apps.sites.footer import save_footer,footer_etag
from apps.media.models import MediaAsset
from apps.media.uploads import upload_asset
from apps.media.services import update_asset
from apps.cms.authorization import cms_administrator_allows
from apps.cms.models import Page
from apps.cms.services.pages import create_page
from apps.cms.services.working_drafts import save_visual_draft,content_etag,open_working_draft
from apps.cms.services.workflow import transition_content
from apps.cms.services.homepage import assign_homepage
from apps.cms.services.menus import create_menu,create_menu_item,set_menu_active,menu_etag
from apps.cms.services.menu_locations import write_location,location_state
from apps.cms.comparison_layout import comparison_layout
from apps.api.models import Post,Category
from apps.api.post_media import validate_post_images

class Command(BaseCommand):
    help='Development-only AAU comparison import; never overwrites an existing university Site.'
    def add_arguments(self,parser):
        parser.add_argument('--directory',required=True)
        parser.add_argument('--site',type=int,required=True)
        parser.add_argument('--actor',required=True)
    def handle(self,*args,**options):
        if not settings.DEBUG:raise CommandError('This reference importer is development-only.')
        site=Site.objects.get(pk=options['site'])
        if site.code!='AAU-COMPARISON' or site.is_main:raise CommandError('Use the isolated AAU-COMPARISON Site.')
        actor=get_user_model().objects.get(username=options['actor'],is_active=True)
        if not cms_administrator_allows(actor,site.pk):raise CommandError('A live administrator membership on the comparison Site is required.')
        directory=Path(options['directory']).resolve();manifest=json.loads((directory/'import-manifest.json').read_text(encoding='utf-8'))
        if manifest['source']!='https://aau.edu.et/' or len(manifest['assets'])>50:raise CommandError('Unsupported comparison fixture.')
        before={s.pk:{'homepage':str(s.homepage_id),'configuration':s.configuration} for s in Site.objects.exclude(pk=site.pk)}
        assets={};states=[]
        for key,entry in manifest['assets'].items():
            path=(directory/entry['file']).resolve()
            if not path.is_relative_to(directory) or not path.is_file():raise CommandError('Unsafe asset path.')
            data=path.read_bytes()
            if len(data)>20*1024*1024 or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise CommandError('Asset checksum/size mismatch.')
            asset=MediaAsset.objects.filter(site_id=site.pk,checksum=entry['sha256'],status='READY',deleted_at__isnull=True).first()
            if asset is None:
                with path.open('rb') as stream:
                    asset=upload_asset(actor,site.pk,stream,filename='AAU comparison - '+key+'.jpg',request_key=uuid.uuid5(uuid.NAMESPACE_URL,f"{site.pk}:{entry['url']}:{entry['sha256']}"),expected_length=len(data))
            start=time.monotonic();seen=[asset.status]
            while asset.status not in {'READY','REJECTED'} and time.monotonic()-start<90:
                time.sleep(.5);asset.refresh_from_db()
                if asset.status!=seen[-1]:seen.append(asset.status)
            if asset.status!='READY':raise CommandError(f'Asset {key} did not reach ready: {asset.status}')
            update_asset(actor,site.pk,asset.pk,changes={'alt_text':entry['alt'][:1000],'display_name':'AAU reference - '+key,'categories':['AAU comparison']})
            assets[key]=str(asset.pk);states.append({'key':key,'asset_id':str(asset.pk),'states':seen,'checksum':asset.checksum,'source':entry['url']})
            self.stdout.write(json.dumps({'asset':key,'status':asset.status}))
        apply_site_configuration(site.pk,{'identity':{'display_name':'Addis Ababa University - comparison','logo_ref':assets['logo']}})
        categories={}
        for label in ['News','Announcements']:
            categories[label],_=Category.objects.get_or_create(site=site,code='AAU_'+label.upper(),defaults={'name':label,'slug':label.lower(),'created_by':actor,'updated_by':actor})
        post_ids=[]
        # Publish oldest first so stable local publication ordering preserves the source ranking.
        for entry in reversed(manifest['news']+manifest['announcements']):
            slug='aau-reference-'+entry['id']
            post=Post.objects.filter(site=site,metadata__aau_comparison__source=entry['source']).first()
            if post is None:
                media=assets.get(entry.get('image',''))
                body='<h2>Reference summary</h2><p>'+escape(entry['summary'])+'</p><p>Original source date: '+escape(entry['source_date'][:10])+'.</p><p><a href="'+escape(entry['source'],quote=True)+'">Read the original AAU article</a>.</p>'
                post=Post(site=site,title=entry['title'],slug=slug,excerpt=entry['summary'],content=body,author=actor,featured_media=f'sites/{site.pk}/assets/{media}' if media else '',metadata={'post_editor':{'schema_version':1,'html':body},'post_media':{'featured_alt':entry['title'][:255]} if media else {},'aau_comparison':{'source':entry['source'],'source_date':entry['source_date']}},created_by=actor,updated_by=actor)
                validate_post_images(post,actor=actor)
                with audit_context(actor_kind='USER',actor_id=str(actor.pk)):post.save(taxonomy={'categories':[categories[entry['category']]]})
            if post.status!='PUBLISHED':transition_content(post.pk,action='publish',actor=actor,comment='Isolated AAU reference comparison release.')
            post_ids.append(str(post.pk))
        layout=comparison_layout(manifest,assets)
        page=Page.objects.filter(site=site,slug='aau-homepage-comparison').first()
        if page is None:page=create_page(site=site,title='AAU homepage comparison',slug='aau-homepage-comparison',actor=actor,blocks=[])
        if page.status!='PUBLISHED':
            page=save_visual_draft(site_id=site.pk,page_id=page.pk,actor=actor,if_match=content_etag(page),visual_layout=layout)
            page=transition_content(page.pk,action='publish',actor=actor,expected_revision=page.revision_number,comment='Published only on the isolated AAU comparison Site.')
        assign_homepage(site_id=site.pk,page_id=page.pk,actor=actor)
        menus={}
        def menu(code,name,links):
            code=code.lower().replace("_","-")
            result=site.menus.filter(code=code).first()
            if result is None:
                result=create_menu(actor=actor,site_id=site.pk,name=name,code=code,location='',is_active=False)
                for label,url in links:
                    result.refresh_from_db();create_menu_item(result.pk,actor=actor,expected=menu_etag(result),label=label,item_type='external' if url.startswith('http') else 'custom',target=url)
                result.refresh_from_db();set_menu_active(result.pk,actor=actor,expected=menu_etag(result),active=True)
            return str(result.pk)
        header=menu('AAU_HEADER','AAU comparison header',[('Home','/'),('Latest news','/posts/categories/news'),('About','https://aau.edu.et/aau-at-a-glance'),('Admission','https://admission.aau.edu.et/'),('Academics','https://aau.edu.et/A-to-Z_listing'),('Research','https://aau.edu.et/research'),('Services','https://aau.edu.et/services')])
        footer=[]
        for name,links in [('Essentials',[('Contact us','contactus'),('Media Gallery','gallery'),('Emergency Services','emergencyservices'),('Archive','archives')]),('About us',[('History','history'),('Leadership','AAU-leadership'),('Presidents','presidents'),('Overview','aau-at-a-glance')]),('Resources',[('Events','events'),('Documents','documents'),('Publications','publications'),('Services','services')]),('Quick links',[('Portal','https://portal.aau.edu.et/'),('E-learning','https://courses.aau.edu.et/'),('Campus life','campus_life'),('Staff','staffs')])]:
            footer.append(menu('AAU_'+name.upper().replace(' ','_'),name,[(label,url if url.startswith('http') else 'https://aau.edu.et/'+url) for label,url in links]))
        for location,values in [('header',[header]),('footer',footer)]:
            state=next(row for row in location_state(site) if row['location']==location)
            row=write_location(site.pk,location,actor=actor,expected=state['version'],replace=True,**({'menu_ids':values} if location=='footer' else {'menu_id':values[0]}))
            write_location(site.pk,location,actor=actor,expected=row['version'],publish=True)
        current=SiteFooter.objects.filter(site=site).first()
        save_footer(site.pk,{'description':'Local AAU reference comparison for CMS review. Original university content: aau.edu.et.','links_heading':'Explore','highlight_label':'Stay Tuned 99.4FM','newsletter_label':'Visit AAU newsletter','newsletter_url':'https://aau.edu.et/','copyright_text':'AAU source content. Local CMS comparison {year}.','social_links':[]},actor=actor,expected=footer_etag(site.pk,current))
        after={s.pk:{'homepage':str(s.homepage_id),'configuration':s.configuration} for s in Site.objects.exclude(pk=site.pk)}
        if after!=before:raise CommandError('Another Site changed during import; inspect the isolation report.')
        draft,_=open_working_draft(page,actor=actor,if_match=content_etag(page))
        report={'draft':str(draft.pk),'site':site.pk,'page':str(page.pk),'host':'aau-review.localhost','assets':states,'posts':post_ids,'rows':len(layout['rows']),'other_sites_unchanged':True,'layout':layout}
        (directory/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        self.stdout.write(json.dumps({'site':site.pk,'page':str(page.pk),'assets':len(assets),'posts':len(post_ids),'rows':len(layout['rows']),'other_sites_unchanged':True}))
