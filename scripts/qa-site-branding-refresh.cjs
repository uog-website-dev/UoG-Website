/** Real Site-admin save -> public refocus -> dynamic branding; private credentials arrive on stdin. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('./perf/node_modules/playwright-core');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),profile=seed.profiles.college;
 const id=seed.sites.college,host=process.env.UOG_QA_SITE_HOST||'coi.uog.local';
 const out=process.env.UOG_QA_OUTPUT||'.git/task-data/branding-refresh';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.UOG_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 let admin,original,written=false;const results=[];
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  admin=await context.newPage();admin.setDefaultTimeout(60000);
  for(let attempt=0;attempt<5;attempt++){
    const response=await admin.goto('http://localhost/admin',{waitUntil:'domcontentloaded'});
    if(![502,503].includes(response.status()))break;
    if(attempt===4)throw Error('Admin service did not become ready');
    await admin.waitForTimeout(1000);
  }
  await admin.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
  await admin.locator('#username').fill(profile.username);await admin.locator('#password').fill(profile.password);await admin.locator('#kc-login').click();
  await admin.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'));
  await admin.goto(`http://localhost/admin/sites/${id}/admin/appearance`,{waitUntil:'domcontentloaded'});
  const title=admin.getByRole('textbox',{name:'Public Site title',exact:true});await title.waitFor();
  assert(await admin.getByRole('link',{name:/Appearance Site logo/}).count()>0,'Appearance navigation entry');
  const publicPage=await context.newPage();publicPage.setDefaultTimeout(60000);let logoRequests=0;
  publicPage.on('request',r=>{if(r.url().includes('/identity/logo/'))logoRequests++;});
  await publicPage.goto(`http://${host}`,{waitUntil:'networkidle'});
  original=await publicPage.evaluate(async()=>await(await fetch('/api/v1/site-context/')).json());
  assert.equal(original.site.id,id);assert.match(original.configuration.branding_revision,/^[a-f0-9]{64}$/);
  const peer=await context.newPage();await peer.goto('http://www.uog.local',{waitUntil:'networkidle'});
  const peerBefore=await peer.evaluate(async()=>await(await fetch('/api/v1/site-context/')).json());
  const baseline=logoRequests,newTitle=`${original.configuration.display_name||original.site.name} QA ${seed.run}`;
  console.log('Checking real appearance save and public refresh');
  await title.fill(newTitle);
  await admin.getByRole('combobox',{name:/Theme/}).click();await admin.getByRole('option',{name:/High contrast/}).click();
  await admin.getByRole('button',{name:'Save appearance',exact:true}).click();
  await admin.getByText(/Appearance saved for this Site/).waitFor();written=true;
  await publicPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await publicPage.getByRole('banner').getByText(newTitle,{exact:true}).waitFor();
  await publicPage.getByRole('contentinfo').getByText(newTitle,{exact:true}).waitFor();
  const widget=publicPage.locator('[data-widget-type="site_title"]');assert(await widget.count()>0,'Representative homepage requires a dynamic Site Title widget');
  await widget.getByText(newTitle,{exact:true}).waitFor();
  assert.equal(await publicPage.locator('[data-public-site]').getAttribute('data-theme'),'high-contrast');
  await publicPage.waitForFunction(()=>{const image=document.querySelector('header img');return image?.complete&&image.naturalWidth>0;});assert(logoRequests>baseline,'Branding change requests the versioned logo again');
  const peerAfter=await peer.evaluate(async()=>await(await fetch('/api/v1/site-context/')).json());assert.deepEqual(peerAfter,peerBefore);
  results.push({check:'real Site Administrator saves title/theme; header/footer/widget refresh without navigation; logo reloads; Main Site unchanged',status:'PASS'});
  await admin.reload({waitUntil:'domcontentloaded'});await admin.waitForFunction(expected=>document.querySelector("#site-appearance-title")?.value===expected,newTitle);results.push({check:'Appearance reopens with persisted effective values',status:'PASS'});
  await admin.waitForFunction(()=>{const image=document.querySelector('section[aria-label="Site logo"] img');return image?.complete&&image.naturalWidth>0;});
  results.push({check:'persisted logo loads from the authenticated Site-scoped image route',status:'PASS'});
  await admin.setViewportSize({width:390,height:844});await admin.screenshot({path:out+'/appearance-mobile.png',fullPage:true});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await admin.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
  const violations=await admin.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[]);results.push({check:'mobile Appearance form: no horizontal overflow or automated WCAG A/AA violations',status:'PASS'});
 } finally {
  try {
   if(written&&admin&&original){
    await admin.getByRole('textbox',{name:'Public Site title',exact:true}).fill(original.configuration.display_name||'');
    await admin.getByRole('combobox',{name:/Theme/}).click();await admin.getByRole('option',{name:original.configuration.theme==='high-contrast'?/High contrast/:/Institutional/}).click();
    await admin.getByRole('button',{name:'Save appearance',exact:true}).click();await admin.getByText(/Appearance saved for this Site/).waitFor();
    const check=await admin.context().newPage();await check.goto(`http://${host}`,{waitUntil:'networkidle'});const restored=await check.evaluate(async()=>await(await fetch('/api/v1/site-context/')).json());assert.deepEqual(restored.configuration,original.configuration);results.push({check:'original Site appearance restored',status:'PASS'});
   }
  } finally {fs.writeFileSync(out+'/results.json',JSON.stringify({run:seed.run,results},null,2));await browser.close();}
 }
 console.log(JSON.stringify(results));
})().catch(error=>{console.error(error.message);process.exitCode=1});
