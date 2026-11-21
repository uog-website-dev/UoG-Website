/* Anonymous two-host regression. No credentials, token bypasses or seeded public payloads. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('./perf/node_modules/playwright-core');
(async()=>{
 const out=process.env.UOG_QA_OUTPUT||'docs/qa/college-workflow-2026-11-21',stage=process.argv[2]||'after';
 const target=JSON.parse(fs.readFileSync(path.join(out,'public-targets.json'),'utf8'));
 const b=await chromium.launch({executablePath:process.env.UOG_QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 try{
 const p=await b.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(30000);
 async function open(host,route='/'){let r=await p.goto('http://'+host+route,{waitUntil:'domcontentloaded',timeout:120000});for(let n=0;r.status()>=500&&n<3;n++)r=await p.reload({waitUntil:'domcontentloaded',timeout:120000});assert(r.status()<500);return r;}
 await open(target.mainHost);await p.getByRole('heading',{name:target.mainHeading,exact:true}).waitFor();await p.getByRole('link',{name:target.mainArticle,exact:true}).first().waitFor();
 const mainText=await p.locator('body').innerText(),mainLinks=await p.locator('body a').evaluateAll(es=>es.map(e=>({text:e.textContent,href:e.getAttribute('href')})));
 const main={text_sha256:crypto.createHash('sha256').update(mainText).digest('hex'),links:mainLinks};
 await p.screenshot({path:path.join(out,'main-'+stage+'.png'),fullPage:true});
 if(stage==='before'){fs.writeFileSync(path.join(out,'main-browser-before.json'),JSON.stringify(main,null,2));return;}
 assert.deepEqual(main,JSON.parse(fs.readFileSync(path.join(out,'main-browser-before.json'),'utf8')),'Main public text/navigation changed');
 await open(target.host);await p.getByRole('heading',{name:target.originalHeading,exact:true}).waitFor();await p.getByRole('link',{name:target.article,exact:true}).first().waitFor();
 assert.equal(await p.getByRole('link',{name:target.mainArticle,exact:true}).count(),0,'Main article leaked into college homepage');
 for(const label of target.menuLabels.slice(0,2))await p.getByRole('link',{name:label,exact:true}).first().waitFor();
 await p.screenshot({path:path.join(out,'college-dynamic-news.png'),fullPage:true});
 const responses=[];
 for(const route of ['/api/v1/site-context/','/api/v1/site-context/homepage/','/api/v1/site-context/posts/','/api/v1/site-context/posts/?site='+target.mainSite]){
  const r=await p.evaluate(async route=>{const r=await fetch(route,{cache:'no-store'});return {status:r.status,body:await r.json()};},route);
  assert([200,...(route.includes('?site=')?[400]:[])].includes(r.status));assert(!JSON.stringify(r.body).includes(target.mainArticle),'Forged Site parameter leaked Main news');responses.push({route,status:r.status});
  if(route==='/api/v1/site-context/')assert.equal(Number(r.body.site.id),target.site);
  if(route.includes('/posts/')&&r.status===200){const entries=r.body.results||r.body.items||r.body;assert(Array.isArray(entries));assert(entries.length>0);for(const post of entries)assert.equal(Number(post.site),target.site);}
 }
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:path.join(out,'college-phone.png'),fullPage:true});
 const toggle=p.getByRole('button',{name:'Open site header',exact:true});await toggle.focus();await p.keyboard.press('Enter');await p.getByRole('link',{name:target.menuLabels[0],exact:true}).waitFor({state:'visible'});await p.screenshot({path:path.join(out,'college-phone-menu.png'),fullPage:true});await p.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await open(target.host,'/'+target.sidebarSlug);await p.getByText(target.sidebarCopy,{exact:true}).waitFor();assert(!(await p.locator('body').innerText()).includes('Main Site student and institutional information.'));
 const unknown='unknown-'+target.run+'.uog.local';await open(unknown);await p.waitForTimeout(500);const text=await p.locator('body').innerText();assert(!text.includes(target.mainHeading)&&!text.includes(target.originalHeading));
 const status=await p.evaluate(async()=>{const r=await fetch('/api/v1/site-context/',{cache:'no-store'});return r.status;});assert.equal(status,404);await p.screenshot({path:path.join(out,'unknown-host.png'),fullPage:true});
 fs.writeFileSync(path.join(out,'public-isolation.json'),JSON.stringify({main_unchanged:true,college_news_only:true,foreign_site_parameter_safe:true,unknown_host_status:status,mobile_no_overflow:true,keyboard_mobile_menu:true,college_page_copy:true,responses},null,2));console.log('Main unchanged, scoped college dynamic news, mobile and unknown hostname PASS');
 }finally{await b.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
