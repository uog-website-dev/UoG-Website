// PERF-002: lazy discovery is included in measured Site switches.
async function chooseSite(page,id){
 await page.getByRole('button',{name:'Workspace',exact:true}).first().click();
 await page.locator(`[data-workspace-site="${id}"]`).click();
}
/* Real-browser measurements; the private session enters on stdin and is never persisted. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT||'playwright-core');
const {summarize,safeUrl,networkSummary}=require('./metrics.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const {spawnSync}=require('node:child_process');
(async()=>{
 const matrix=process.env.PERF_SECTION_MATRIX==='1', dashboardProbes=process.env.PERF_DASHBOARD_PROBES==='1';
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),origin=process.env.PERF_ORIGIN||'http://localhost:8088',mode=process.env.PERF_MODE||'production';
 assert(['production','development'].includes(mode));assert(seed.sites.length>=10,'Seed at least 10 Sites first');
 const n=Number(process.env.PERF_SAMPLES||10);assert(Number.isSafeInteger(n)&&n>=2&&n<=100);
 const out=path.resolve(process.env.PERF_OUTPUT||`docs/qa/P0-PERF-001/2026-11-15/${mode}`);fs.mkdirSync(out,{recursive:true});
 const run=crypto.randomUUID(),samples=[],failures=[],browser=await chromium.launch({executablePath:process.env.PERF_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 let observedPage=null;
 const metadata={run,mode,release_baseline:mode==='production',budgets_status:'PROPOSED',method:'nearest-rank percentiles',samples_per_scenario:n,sites:seed.sites,counts_per_site:seed.counts_per_site,api_cache_definition:'First versus immediate repeat per Site/resource; server caches retained',automatic_prefetch:'Content rail uses explicit hover/focus intent with 180 ms dwell and 1 s throttle; normal prefetch on other links remains; pre-initiation traffic is outside measured navigation',network:{profile:'loopback, unthrottled',cpu_slowdown:1,viewport:[1440,1000]},browser:browser.version(),started_at:new Date().toISOString(),cold_definition:'fresh browser context and HTTP cache; target Site absent from Next router cache; application/database caches retained',warm_definition:'same browser context; previously visited target; no forced invalidation',session_policy:'Independent real Keycloak browser sign-in before every cold/warm iteration; login is excluded from timings; each pair uses one active session',authentication_role:`Site Administrator on ${seed.sites.length} benchmark Sites; no platform role`,sampling_warning:n<20?'SMOKE: p95 is a small-sample diagnostic; use >=30 per scenario for acceptance.':null};
 metadata.react_profiling=process.env.PERF_RENDER_PROFILING==='1';
 metadata.release_baseline=mode==='production'&&!metadata.react_profiling;
 metadata.section_matrix=matrix;
 metadata.dashboard_probes=dashboardProbes;
 metadata.interaction='Searchable Workspace dialog; discovery is included in switch timing';
 metadata.site_switch_policy='Preserve authorized section root; read caches scoped to session/Site/authorization; 30-second context lease, 5-minute inactive GC; mutable forms reset';
 metadata.cache_policy='PERF-005: scoped navigation controls plus PERF-004 30-second in-memory context/read lease, five-minute inactive GC; scoped reuse on Site return, disposal on session change and purge on Site authorization change';
 metadata.source={commit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),files:{}};
 for(const file of ['frontend/pnpm-lock.yaml','frontend/apps/admin-web/next.config.ts','frontend/apps/admin-web/src/performance/navigation-timing.tsx','frontend/apps/admin-web/src/performance/server-fetch.ts','backend/apps/core/middleware.py','backend/config/settings.py','backend/apps/core/dashboard.py','backend/apps/core/dashboard_cache.py','docker-compose.perf.yml','infrastructure/nginx/performance.conf','scripts/perf/benchmark.cjs','scripts/perf/metrics.cjs','scripts/perf/package-lock.json','backend/apps/sites/api/workspace.py','backend/apps/authorization/services.py','frontend/apps/admin-web/src/workspace.ts','frontend/apps/admin-web/src/workspace-switcher.tsx','frontend/apps/admin-web/src/workspace-proxy.ts','frontend/apps/admin-web/src/sites/site-workspace.tsx','frontend/apps/admin-web/src/sites/site-admin-frame.tsx','frontend/apps/admin-web/src/sites/site-admin.ts','frontend/apps/admin-web/src/sites/site-draft-guard.ts','frontend/apps/admin-web/src/sites/site-page-editor.tsx','frontend/apps/admin-web/src/data/query-cache.tsx','frontend/apps/admin-web/src/data/section-state.ts','frontend/apps/admin-web/src/data/page-boundary.ts','frontend/apps/admin-web/src/data/section-prefetch.ts','frontend/apps/admin-web/src/sidebar.tsx','frontend/apps/admin-web/src/data/admin-query-provider.tsx','frontend/apps/admin-web/src/cache-identity.ts','frontend/apps/admin-web/src/organizations/contract.ts','frontend/apps/admin-web/src/sites/media-library.tsx','frontend/apps/admin-web/src/sites/site-pages.tsx','frontend/apps/admin-web/src/sites/site-dashboard.tsx','frontend/apps/admin-web/src/app/sites/dashboard-actions.ts','frontend/apps/admin-web/src/sites/site-posts.tsx','frontend/apps/admin-web/src/sites/site-menus.tsx','frontend/apps/admin-web/src/app/sites/[id]/admin/layout.tsx'])metadata.source.files[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 function persist(){const result={metadata,summary:summarize(samples),by_cache_state:{cold:summarize(samples.filter(s=>s.cache_state==='cold')),warm:summarize(samples.filter(s=>s.cache_state==='warm'))},samples,failures};const file=path.join(out,'results.json');fs.writeFileSync(file+'.tmp',JSON.stringify(result,null,2));fs.renameSync(file+'.tmp',file);}
 function addSample(sample){samples.push(sample);persist();}
 metadata.run_status='running';persist();
 function options(state){return {viewport:{width:1440,height:1000},...(state?{storageState:state}:{}),serviceWorkers:'block'};}
 async function usable(page,site,section){
  await page.waitForURL(u=>u.pathname.replace(/\/$/,'')===`/admin/sites/${site}/admin${section==='dashboard'?'':'/'+section}`);
  await page.waitForFunction(({site,section})=>{
   const scope=document.querySelector(`[data-perf-site-id="${site}"]`),content=scope?.querySelector(`[data-perf-section="${section}"]`);
   const nav=[...document.querySelectorAll('[data-perf-navigation-ready="true"]')].some(el=>el.getBoundingClientRect().width>0);
   if(scope?.querySelector('[data-perf-error="true"],.MuiAlert-standardError,.MuiAlert-outlinedError'))return true;
   return !!content&&nav&&content.getAttribute('data-perf-pending')!=='true'&&!scope.querySelector('[data-perf-pending="true"],.MuiSkeleton-root');
  },{site,section},{timeout:120000});
  const errors=await page.locator(`[data-perf-site-id="${site}"] [data-perf-error="true"], [data-perf-site-id="${site}"] .MuiAlert-standardError, [data-perf-site-id="${site}"] .MuiAlert-outlinedError`).count();assert.equal(errors,0,'Usable content contains a failed data source');
  if(section==='pages'||section==='posts')assert(await page.getByRole('table',{name:section==='pages'?'Pages for this Site':'Posts for this Site'}).locator('tbody tr').count()>0,'Representative list must contain rows');
 }
 async function measure(context,page,scenario,site,section,act,cache){
  const id=crypto.randomUUID(),rows=new Map(),pending=new Set(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await context.setExtraHTTPHeaders({'X-Navigation-ID':id,'X-Request-ID':id});
  let firstTimestamp=null,navigationEpoch=0;
  cdp.on('Network.requestWillBeSent',event=>{if(!/^https?:/.test(event.request.url))return;const url=new URL(event.request.url);if(url.origin!==origin||url.pathname.includes('/api/auth'))return;
   firstTimestamp??=event.timestamp;rows.set(event.requestId,{cdp_id:event.requestId,method:event.request.method,path:safeUrl(event.request.url),action_id:(event.request.headers['Next-Action']||event.request.headers['next-action']||'').slice(0,80)||null,start_timestamp:event.timestamp,start_ms:event.wallTime*1000-navigationEpoch,initiator_type:event.initiator.type,initiator_request_id:event.initiator.requestId??null,request_id:event.request.headers['X-Request-ID']||event.request.headers['x-request-id']||id,status:null,request_payload_bytes:Buffer.byteLength(event.request.postData??''),encoded_bytes:0});pending.add(event.requestId);});
  cdp.on('Network.responseReceived',event=>{const row=rows.get(event.requestId);if(!row)return;const h=Object.fromEntries(Object.entries(event.response.headers).map(([k,v])=>[k.toLowerCase(),v]));Object.assign(row,{status:event.response.status,request_id:h['x-request-id']||row.request_id,navigation_id:h['x-navigation-id']||null,server_timing:h['server-timing']||null,from_disk_cache:!!event.response.fromDiskCache,timing:event.response.timing?{dns_ms:Math.max(0,event.response.timing.dnsEnd-event.response.timing.dnsStart),connect_ms:Math.max(0,event.response.timing.connectEnd-event.response.timing.connectStart),wait_ms:Math.max(0,event.response.timing.receiveHeadersStart-event.response.timing.sendEnd)}:null});});
  cdp.on('Network.loadingFinished',event=>{const row=rows.get(event.requestId);if(row)Object.assign(row,{duration_ms:(event.timestamp-row.start_timestamp)*1000,encoded_bytes:event.encodedDataLength});pending.delete(event.requestId);});
  cdp.on('Network.loadingFailed',event=>{const row=rows.get(event.requestId);if(row){row.failed=true;row.cancelled=!!event.canceled;row.network_error=event.errorText;}pending.delete(event.requestId);});
  navigationEpoch=Date.now();
  await page.evaluate(({id,site,section})=>{const target=`/admin/sites/${site}/admin${section==='dashboard'?'':'/'+section}`,epoch_ms=Date.now();
   // Install the boundary before selective hydration can defer the optional app hook.
   sessionStorage.setItem('uog:performance:active-navigation',JSON.stringify({id,epoch_ms,target}));
   performance.mark(`uog:navigation:${id}:start`,{detail:{scope:'current-document',original_start_epoch_ms:epoch_ms}});
   window.dispatchEvent(new CustomEvent('uog:navigation:start',{detail:{id,target}}));
  },{id,site,section});
  const start=performance.now();
  try{
   await act();await usable(page,site,section);const duration=performance.now()-start,pendingAtUsable=pending.size;
   await page.evaluate(id=>{
    let beginning=performance.getEntriesByName(`uog:navigation:${id}:start`).at(-1);
    if(!beginning){const stored=JSON.parse(sessionStorage.getItem('uog:performance:active-navigation')??'null');if(!stored||stored.id!==id)throw new Error('Navigation identity lost across reload');performance.mark(`uog:navigation:${id}:start`,{startTime:0,detail:{scope:'resumed-document',original_start_epoch_ms:stored.epoch_ms}});beginning=performance.getEntriesByName(`uog:navigation:${id}:start`).at(-1);}
    window.dispatchEvent(new CustomEvent('uog:navigation:usable',{detail:{id}}));
    performance.mark(`uog:navigation:${id}:usable`);performance.measure(`uog:navigation:${id}`,{start:`uog:navigation:${id}:start`,end:`uog:navigation:${id}:usable`,detail:beginning.detail});sessionStorage.removeItem('uog:performance:active-navigation');
   },id);
   const browserMeasure=await page.evaluate(id=>(()=>{const entry=performance.getEntriesByName(`uog:navigation:${id}`,'measure').at(-1);return entry?{duration_ms:entry.duration,scope:entry.detail?.scope??'current-document'}:null;})(),id);assert(browserMeasure!=null,'Browser navigation performance marks are missing');
   // Capture trailing network completion separately; never add this grace interval to usable time.
   await delay(250);const network=[...rows.values()].map(({start_timestamp,...row})=>row);if(networkSummary(network).failed_requests){failures.push({type:'NavigationNetworkFailure',scenario,site_id:site,navigation_id:id,requests:network.filter(row=>(row.failed&&!row.cancelled)||row.status>=400)});}
   assert.equal(networkSummary(network).failed_requests,0,'A navigation network request failed');
   addSample({scenario,cache_state:cache,navigation_id:id,site_id:site,section,duration_ms:duration,dashboard_usable_ms:section==='dashboard'?duration:null,...networkSummary(network),browser_measure_ms:browserMeasure.duration_ms,browser_measure_scope:browserMeasure.scope,in_flight_at_usable_boundary:pendingAtUsable,waterfall:network,blocking_waterfall_candidates:network.filter(row=>row.start_ms>100).map(row=>({cdp_id:row.cdp_id,path:row.path,start_ms:row.start_ms,wait_ms:row.timing?.wait_ms??null,initiator_type:row.initiator_type})),waterfall_note:'Start offsets are relative to navigation initiation; temporal sequences are candidates, not proof of causal blocking.'});
   console.log(JSON.stringify({scenario,cache_state:cache,sample:samples.filter(s=>s.scenario===scenario).length,duration_ms:Math.round(duration),requests:network.length}));
  }finally{await context.setExtraHTTPHeaders({});await cdp.detach();}
 }
 try{
  const login=await browser.newContext(options()),page=await login.newPage();page.setDefaultTimeout(120000);observedPage=page;
  let loaded=false;for(let attempt=0;attempt<30;attempt++){try{const r=await page.goto(origin+'/admin',{waitUntil:'domcontentloaded',timeout:120000});if(r.status()<500){loaded=true;break;}}catch{}await delay(2000);}assert(loaded,'Benchmark app is not ready');
  await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill(seed.actor.username);await page.locator('#password').fill(seed.actor.password);await page.locator('#kc-login').click();console.log(JSON.stringify({phase:'auth_redirect',origin:new URL(page.url()).origin,path:new URL(page.url()).pathname}));await page.waitForURL(u=>u.origin===origin&&/^\/admin\/?$/.test(u.pathname),{waitUntil:'domcontentloaded',timeout:30000});await page.waitForLoadState('domcontentloaded');
  metadata.authentication={landing_path:new URL(page.url()).pathname,error_code:new URL(page.url()).searchParams.get('error'),session_cookie_present:(await login.cookies()).some(c=>c.name.includes('session-token'))};console.log(JSON.stringify(metadata.authentication));assert(metadata.authentication.session_cookie_present&&!metadata.authentication.error_code,'Real browser sign-in did not establish a usable session');

  await page.getByRole('button',{name:'Workspace',exact:true}).first().waitFor();
  await measure(login,page,'first_site_visit',seed.sites[0].id,'dashboard',()=>chooseSite(page,seed.sites[0].id),'cold');
  // Direct Django API timings come first, while the separately issued token is fresh.
  for(let i=0;i<n;i++)for(const resource of ['pages','posts','assets'])for(const cache of ['cold','warm']){
   const site=seed.sites[i%seed.sites.length].id,id=crypto.randomUUID(),url=`${origin}/api/v1/sites/${site}/${resource}/?page=1&page_size=20`;
   const result=await page.evaluate(async({url,token,id})=>{const start=performance.now(),r=await fetch(url,{headers:{Authorization:'Bearer '+token,'X-Navigation-ID':id,'X-Request-ID':id}});await r.arrayBuffer();return {status:r.status,duration_ms:performance.now()-start,request_id:r.headers.get('x-request-id'),sql_count:Number(r.headers.get('x-sql-count')),sql_ms:Number(r.headers.get('x-sql-time-ms'))};},{url,token:seed.actor.token,id});assert.equal(result.status,200,`List ${resource} probe failed`);addSample({scenario:'paginated_list_api',cache_state:cache,resource,site_id:site,navigation_id:id,...result});
  }
  for(let i=0;i<n;i++)for(const cache of ['cold','warm']){const site=seed.sites[i%seed.sites.length].id,id=crypto.randomUUID(),result=await page.evaluate(async({site,id})=>{const started=performance.now(),r=await fetch(`/admin/api/workspace/?site=${site}`,{headers:{'X-Navigation-ID':id,'X-Request-ID':id},cache:'no-store'});const body=await r.json();return {status:r.status,duration_ms:performance.now()-started,request_id:r.headers.get('x-request-id')||id,site:body.site?.id};},{site,id});assert.equal(result.status,200);assert.equal(result.site,site);addSample({scenario:'workspace_api',cache_state:cache,navigation_id:id,site_id:site,...result});}
  if(dashboardProbes){
   const reset=spawnSync('docker',['compose','exec','-T','backend','python','manage.py','shell','-c',"import json; from pathlib import Path; from django.conf import settings; from apps.core.dashboard_cache import invalidate; assert settings.DEBUG; data=json.loads(Path('/tmp/perf001-session.json').read_text()); [invalidate(row['id']) for row in data['sites']]; print('Managed dashboard generations reset')"],{encoding:'utf8'});
   assert.equal(reset.status,0,'Cannot reset managed dashboard generations');
   for(let i=0;i<n;i++)for(const cache of ['cold','warm']){
    const site=seed.sites[i%seed.sites.length].id,id=crypto.randomUUID();
    const result=await page.evaluate(async({site,id,token})=>{const start=performance.now(),r=await fetch(`/api/workspace/dashboard/?site=${site}`,{headers:{Authorization:'Bearer '+token,'X-Navigation-ID':id,'X-Request-ID':id}});const body=await r.json();return {status:r.status,duration_ms:performance.now()-start,request_id:r.headers.get('x-request-id')||id,site:body.site,cache_hit:body.cache?.hit,sections:body.sections};},{site,id,token:seed.actor.token});
    assert.equal(result.status,200);assert.equal(result.site,site);assert.equal(result.cache_hit,cache==='warm','Redis hit/miss expectation failed');
    addSample({scenario:'dashboard_summary_api',cache_state:cache,navigation_id:id,site_id:site,...result});
   }
  }
  await login.close();
  for(let i=0;i<n;i++){
   const context=await browser.newContext(options()),page=await context.newPage();page.setDefaultTimeout(120000);observedPage=page;
   // Control authentication age without changing token lifetimes or authorization.
   await page.goto(origin+'/admin',{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
   await page.locator('#username').fill(seed.actor.username);await page.locator('#password').fill(seed.actor.password);await page.locator('#kc-login').click();
   await page.waitForURL(u=>u.origin===origin&&/^\/admin\/?$/.test(u.pathname),{waitUntil:'domcontentloaded',timeout:30000});
   assert((await context.cookies()).some(c=>c.name.includes('session-token')),'Fresh real browser authentication failed');
   const source=seed.sites[i%seed.sites.length].id,target=seed.sites[(i+1)%seed.sites.length].id;
   await page.goto(`${origin}/admin/sites/${source}/admin`,{waitUntil:'domcontentloaded'});await usable(page,source,'dashboard');
   const switchSite=id=>chooseSite(page,id);
   const navigate=label=>page.getByRole('navigation',{name:'Site sections',exact:true}).getByRole('link').filter({hasText:label}).click();
   await measure(context,page,'cold_site_switch',target,'dashboard',()=>switchSite(target),'cold');
   await switchSite(source);await usable(page,source,'dashboard');
   await measure(context,page,'warm_site_switch',target,'dashboard',()=>switchSite(target),'warm');
   const section=['pages','posts','menus'][i%3],label={pages:'Pages',posts:'Posts',menus:'Menus'}[section];
   await measure(context,page,'same_site_menu_navigation',target,section,()=>navigate(label),'cold');
   await measure(context,page,'cached_section_return',target,'dashboard',()=>navigate('Dashboard'),'warm');
   await measure(context,page,'cached_section_transition',target,section,()=>navigate(label),'warm');
   if(matrix)for(const name of ['pages','posts','menus','media']){
    const label={pages:'Pages',posts:'Posts',menus:'Menus',media:'Media'}[name];
    await navigate(label);await usable(page,target,name);
    await navigate('Dashboard');await usable(page,target,'dashboard');
    await measure(context,page,`cached_${name}_return`,target,name,()=>navigate(label),'warm');
   }
   await context.close();
  }
 }catch(error){failures.push({page_origin:observedPage?new URL(observedPage.url()).origin:null,page_pathname:observedPage?new URL(observedPage.url()).pathname:null,type:error.name,message:String(error.message).replaceAll(seed.actor.password,'[REDACTED]').replaceAll(seed.actor.token,'[REDACTED]').replace(/https?:\/\/[^\s]+/g,'[URL omitted]').slice(0,500)});process.exitCode=1;}
 finally{metadata.completed_at=new Date().toISOString();metadata.run_status=failures.length?'failed':'complete';if(!failures.length&&samples.length!==1+(13+(matrix?4:0)+(dashboardProbes?2:0))*n){failures.push({type:'IncompleteRun',message:'The benchmark sample matrix is incomplete'});metadata.run_status='failed';process.exitCode=1;}persist();await browser.close();}
})().catch(error=>{console.error('Benchmark failed: '+error.name);process.exitCode=1;});
