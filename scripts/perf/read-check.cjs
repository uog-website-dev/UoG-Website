/* Real session/BFF checks. Private seed enters stdin; never write credentials. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT||'playwright-core');
const {percentile}=require('./metrics.cjs');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),origin=process.env.PERF_ORIGIN||'http://localhost:8088',output=process.env.PERF_OUTPUT||'docs/qa/P0-PERF-008/local';fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.PERF_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();const reads=[];let phase='sign in';
 try{
  await page.goto(origin+'/admin');await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill(seed.actor.username);await page.locator('#password').fill(seed.actor.password);await page.locator('#kc-login').click();await page.waitForURL(url=>url.origin===origin&&/^\/admin\/?$/.test(url.pathname));
  phase='same-origin GET and secrets';
  page.on('request',r=>{if(r.url().includes('/admin/api/reads?')){assert.equal(r.method(),'GET');assert(!r.headers().authorization);reads.push(new URL(r.url()).searchParams.get('resource'));}});
  const samples=[],resources=['pages','posts','media','menus','inheritance','categories','tags','dashboard-summary','dashboard-activity'];
  for(const resource of resources)for(let i=0;i<10;i++){
   const row=await page.evaluate(async({site,resource})=>{const started=performance.now();const response=await fetch(`/admin/api/reads?site=${site}&resource=${resource}`,{credentials:'same-origin'});const received=performance.now();const raw=await response.text();const parseStarted=performance.now(),data=JSON.parse(raw),ended=performance.now();return {resource,status:response.status,duration_ms:ended-started,headers_ms:received-started,parse_ms:ended-parseStarted,bytes:new TextEncoder().encode(raw).length,server_timing:response.headers.get('server-timing'),content_encoding:response.headers.get('content-encoding'),cache_control:response.headers.get('cache-control'),site:data.site??data.results?.[0]?.site??(Array.isArray(data)?data[0]?.site:null),request_id:response.headers.get('x-request-id'),containsTokenFields:/"(?:accessToken|refreshToken|access_token|refresh_token)"\s*:/.test(raw)};},{site:seed.sites[0].id,resource});
   assert.equal(row.status,200);if(resource!=='inheritance'||row.site!=null)assert.equal(row.site,seed.sites[0].id);assert.equal(row.containsTokenFields,false);assert.equal(row.cache_control,'private, no-store');assert.equal(row.content_encoding,'gzip');assert(row.server_timing.includes('encode;dur='));assert(row.request_id);samples.push(row);
  }
  const session=await context.request.get(origin+'/admin/api/auth/session');const sessionText=await session.text();assert(!/"(?:accessToken|refreshToken|access_token|refresh_token)"\s*:/.test(sessionText));assert(!sessionText.includes(seed.actor.token));
  const cookies=await context.cookies();assert(cookies.filter(c=>c.name.includes('session-token')).every(c=>c.httpOnly));
  phase='denials';const url=origin+`/admin/api/reads?site=${seed.sites[0].id}&resource=pages`;
  assert.equal((await context.request.post(url,{data:{title:'must not write'}})).status(),405);
  assert.equal((await context.request.get(url,{headers:{Origin:'https://untrusted.test'}})).status(),403);
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(url)).status(),401);await anonymous.close();
  const probe=spawnSync('docker',['compose','exec','-T','backend','python','manage.py','shell'],{input:"from apps.sites.models import Site\nprint(Site.objects.exclude(code__startswith='PERF001-').values_list('id',flat=True).first())\n",encoding:'utf8'});assert.equal(probe.status,0);const foreign=Number(probe.stdout.trim());assert(foreign>0);
  assert.equal((await context.request.get(origin+`/admin/api/reads?site=${foreign}&resource=pages`)).status(),403);
  phase='workspace navigation';await page.getByRole('button',{name:'Workspace',exact:true}).first().click();await page.locator(`[data-workspace-site="${seed.sites[0].id}"]`).click();await page.locator(`[data-perf-site-id="${seed.sites[0].id}"]`).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-perf-section="dashboard"] section dl').length===5);
  assert(reads.includes('dashboard-summary'));assert(reads.includes('dashboard-activity'));
  const summary={};for(const resource of resources){const rows=samples.filter(s=>s.resource===resource);summary[resource]={n:rows.length,p50_ms:percentile(rows.map(r=>r.duration_ms),.5),p95_ms:percentile(rows.map(r=>r.duration_ms),.95),parse_p95_ms:percentile(rows.map(r=>r.parse_ms),.95),encode_p95_ms:percentile(rows.map(r=>Number(/encode;dur=([\d.]+)/.exec(r.server_timing)?.[1])),.95),proxy_overhead_p95_ms:percentile(rows.map(r=>Number(/bff;dur=([\d.]+)/.exec(r.server_timing)?.[1])-Number(/upstream;dur=([\d.]+)/.exec(r.server_timing)?.[1])),.95)};}
  fs.writeFileSync(path.join(output,'browser-reads.json'),JSON.stringify({status:'PASS',browser:browser.version(),checks:['Real Keycloak session; GET uses cookie without browser Authorization','Scope, private cache and correlation headers','No token fields in session/read JSON; HttpOnly session cookie','Anonymous 401, foreign Site 403, hostile Origin 403, POST 405','Dashboard uses independent summary/activity GETs'],summary,samples},null,2));console.log('Read BFF browser checks PASS');
 }catch(error){fs.writeFileSync(path.join(output,'browser-reads.json'),JSON.stringify({status:'FAIL',phase,message:error instanceof assert.AssertionError?error.message:'Browser check failed; no raw provider/credential output recorded'},null,2));throw new Error('Read checks failed at '+phase);}
 finally{await context.close();await browser.close();}
})();
