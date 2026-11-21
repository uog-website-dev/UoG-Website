/* PERF-006 real-service count reconciliation and progressive widget faults. Private stdin. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT||'playwright-core');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),origin=process.env.PERF_ORIGIN||'http://localhost:8088',[a,b]=seed.sites.map(row=>row.id);
 const browser=await chromium.launch({executablePath:process.env.PERF_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const result={status:'RUNNING',checks:[],browser:browser.version()};let phase='reconciliation',disabled=false;
 const shell=code=>{const process=spawnSync('docker',['compose','exec','-T','backend','python','manage.py','shell','-c',code],{encoding:'utf8'});assert.equal(process.status,0,'Managed fixture helper failed');return process.stdout.trim();};
 const moduleState=enable=>shell(`from django.conf import settings; from apps.sites.models import Site,Module; from apps.sites.services.modules import enable_module_for_site,disable_module_for_site; assert settings.DEBUG; site=Site.objects.get(pk=${b},code__startswith='PERF001-'); ${(enable?'enable':'disable')}_module_for_site(site.pk,Module.objects.get(code='POSTS').pk); print('Managed module restored' if ${enable?'True':'False'} else 'Managed module disabled')`);
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);
  const headers={Authorization:'Bearer '+seed.actor.token};
  const expected=JSON.parse(shell(`import json; from pathlib import Path; from django.conf import settings; from django.db.models import Count,Q; from django.utils import timezone; from apps.cms.models import Page; from apps.api.models import Post; from apps.cms.menu_models import Menu,MenuItem; from apps.media.models import MediaAsset; from apps.authorization.models import UserRoleAssignment; assert settings.DEBUG; data=json.loads(Path('/tmp/perf001-session.json').read_text()); result={}
for row in data['sites'][:2]:
 site=row['id']; values={}
 for kind,model in [('pages',Page),('posts',Post)]:
  counts={status:0 for status in ['DRAFT','IN_REVIEW','APPROVED','PUBLISHED','UNPUBLISHED','ARCHIVED']}; counts.update({r['status']:r['n'] for r in model.objects.filter(site_id=site).values('status').annotate(n=Count('pk'))}); counts['total']=sum(counts.values()); values[kind]=counts
 menus=Menu.objects.filter(site_id=site,is_global=False); values['menus']={'total':menus.count(),'active':menus.filter(is_active=True).count(),'items':MenuItem.objects.filter(site_id=site,menu__site_id=site,menu__is_global=False).count()}; values['media']={'total':MediaAsset.objects.filter(site_id=site,deleted_at__isnull=True).count()}; members=UserRoleAssignment.objects.filter(site_id=site,scope='SITE',user__is_active=True,role__is_active=True,revoked_at__isnull=True).filter(Q(expires_at__isnull=True)|Q(expires_at__gt=timezone.now())); values['users']={'total':members.values('user_id').distinct().count()}; result[str(site)]=values
print(json.dumps(result))`));
  result.reconciliation=[];
  for(const site of[a,b]){
   const response=await context.request.get(`${origin}/api/workspace/dashboard/?site=${site}`,{headers});assert.equal(response.status(),200);const body=await response.json();
   for(const[kind,counts]of Object.entries(expected[site]))assert.deepEqual(body.sections[kind].counts,counts);
   const warm=await context.request.get(`${origin}/api/workspace/dashboard/?site=${site}`,{headers});assert.equal((await warm.json()).cache.hit,true);
   result.reconciliation.push({site,counts_match:true,redis_hit:true,counts:expected[site]});
  }
  result.checks.push('Two-Site API counts reconcile with independent grouped/source queries; real Redis repeat hits');
  phase='browser essentials';const actions=[];
  page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname.endsWith('/api/reads')&&['dashboard-summary','dashboard-activity'].includes(new URL(request.url()).searchParams.get('resource')))actions.push(new URL(request.url()).searchParams.get('resource'));});
  await page.goto(origin+'/admin');await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill(seed.actor.username);await page.locator('#password').fill(seed.actor.password);await page.locator('#kc-login').click();await page.waitForURL(url=>url.origin===origin&&/^\/admin\/?$/.test(url.pathname));
  actions.length=0; // Authentication itself is a separate server action.
  const choose=async id=>{await page.getByRole('button',{name:'Workspace',exact:true}).first().click();await page.locator(`[data-workspace-site="${id}"]`).click();};
  const ready=async id=>{await page.locator(`[data-perf-site-id="${id}"]`).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-perf-section="dashboard"] section dl').length===5);};
  await choose(a);await ready(a);await page.waitForFunction(()=>document.querySelector('[data-dashboard-secondary-pending]')?.getAttribute('data-dashboard-secondary-pending')==='false');
  assert.equal(actions.length,2,'Dashboard must request one summary and one activity read');assert.equal(new Set(actions).size,2,'Duplicate dashboard endpoint read');
  result.essential_reads=1;result.secondary_reads=1;result.checks.push('Five summary cards use one essential GET; activity uses one independent GET');
  phase='delayed/failed secondary';let release,enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;}),held=new Promise(resolve=>{release=resolve;});
  await page.route('**/admin/**',async route=>{if(route.request().method()==='GET'&&new URL(route.request().url()).searchParams.get('resource')==='dashboard-activity'){enteredResolve();await held;await route.abort('failed');}else await route.continue();});
  await page.reload();await entered;await ready(a);assert(await page.getByText(/Loading recent activity/).isVisible());
  release();await page.getByText('Recent activity is unavailable. Summary counts remain available.').waitFor();assert.equal(await page.locator('[data-perf-section="dashboard"] section dl').count(),5);
  await page.unroute('**/admin/**');result.checks.push('Held secondary leaves all essentials visible; transport failure shows independent retry UI');
  phase='slow summary';let resume,startedResolve;const started=new Promise(resolve=>{startedResolve=resolve;}),pending=new Promise(resolve=>{resume=resolve;});
  await page.route('**/admin/**',async route=>{if(route.request().method()==='GET'&&new URL(route.request().url()).searchParams.get('resource')==='dashboard-summary'){startedResolve();await pending;await route.continue();}else await route.continue();});
  await page.reload();await started;assert(await page.getByRole('link',{name:'Create page',exact:true}).isVisible());assert.equal(await page.locator('[data-perf-section="dashboard"] section dl').count(),0);resume();await ready(a);await page.unroute('**/admin/**');result.checks.push('Slow essential request retains quick actions and honest first-load skeletons, then recovers');
  phase='disabled module';moduleState(false);disabled=true;await choose(b);await page.locator(`[data-perf-site-id="${b}"]`).waitFor();await page.getByText(/Not enabled for this Site: Posts/).waitFor();assert.equal(await page.getByRole('region',{name:'Posts',exact:true}).count(),0);
  const gated=await context.request.get(`${origin}/api/workspace/dashboard/?site=${b}`,{headers});assert(!('posts' in (await gated.json()).sections));moduleState(true);disabled=false;result.checks.push('Disabling POSTS hides its card/counts on Site B without changing Site A; managed module restored');
  result.status='PASS';
 }catch(error){result.status='FAIL';result.failed_phase=phase;result.error={type:error.name,message:String(error.message).split('Call log:')[0].replaceAll(seed.actor.password,'[REDACTED]').replaceAll(seed.actor.token,'[REDACTED]').replace(/https?:\/\/[^\s]+/g,'[URL omitted]').slice(0,400)};process.exitCode=1;}
 finally{if(disabled){moduleState(true);result.module_restored=true;}await browser.close();}
 if(process.env.PERF_DASHBOARD_CHECK_OUTPUT)fs.writeFileSync(process.env.PERF_DASHBOARD_CHECK_OUTPUT,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(()=>{console.error('Dashboard check failed before recording results.');process.exitCode=1;});
