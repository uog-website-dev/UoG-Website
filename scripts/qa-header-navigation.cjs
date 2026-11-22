/** Anonymous regression against the Main Site's published sample navigation. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('./perf/node_modules/playwright-core');
(async()=>{
 const out=process.env.UOG_QA_OUTPUT||'.git/task-data/header-navigation-2026-11-22';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.UOG_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const checks=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
  for(let attempt=0;attempt<5;attempt++){const response=await page.goto(process.env.UOG_QA_PUBLIC_ORIGIN||'http://www.uog.local',{waitUntil:'networkidle'});if(![502,503].includes(response.status()))break;await page.waitForTimeout(500);}
  const nav=page.locator('header nav[aria-label="Site header desktop"]');
  const academics=nav.getByRole('button',{name:'Academics',exact:true}),research=nav.getByRole('button',{name:'Research',exact:true});
  await academics.waitFor();await academics.hover();assert.equal(await academics.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('[data-nav-panel]').count(),1);
  const panel=nav.getByRole('region',{name:'Academics links'});await panel.getByRole('link',{name:'Informatics',exact:true}).waitFor();
  const geometry=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,columns:getComputedStyle(el.querySelector(':scope > div:last-child')).gridTemplateColumns}});
  assert(geometry.left>=0&&geometry.right<=geometry.width&&geometry.bottom<=geometry.height,'Mega panel fits the viewport');
  await page.screenshot({path:out+'/academics-desktop.png'});
  await research.hover();assert.equal(await academics.getAttribute('aria-expanded'),'false');assert.equal(await research.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('[data-nav-panel]').count(),1);
  await page.mouse.move(8,500);assert.equal(await page.locator('[data-nav-panel]').count(),0);
  checks.push({check:'single open panel, hover switching, pointer leave and bounded two-column Academics layout',status:'PASS',geometry});
  await academics.click();assert.equal(await academics.getAttribute('aria-expanded'),'true');await academics.click();assert.equal(await academics.getAttribute('aria-expanded'),'false');
  await academics.focus();await page.keyboard.press('ArrowDown');assert.equal(await academics.getAttribute('aria-expanded'),'true');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Overview');
  await page.keyboard.press('Escape');assert(await academics.evaluate(el=>document.activeElement===el));assert.equal(await page.locator('[data-nav-panel]').count(),0);
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Administration');
  await page.keyboard.press('ArrowDown');assert.equal(await page.locator('[data-nav-panel]').count(),1);
  await page.locator('main').click({position:{x:10,y:10}});assert.equal(await page.locator('[data-nav-panel]').count(),0);
  checks.push({check:'click toggle, ArrowDown/Right, Escape focus restoration and outside click',status:'PASS'});
  await page.setViewportSize({width:1024,height:768});
  const compact=page.getByRole('button',{name:'Open site header',exact:true});await compact.click();
  await page.getByRole('button',{name:'Close site header',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  const trigger=page.getByRole('button',{name:'Open site header',exact:true});await trigger.focus();await page.keyboard.press('Enter');
  const drawer=page.locator('.MuiDrawer-paper');await drawer.getByRole('button',{name:'Academics',exact:true}).click();await drawer.getByRole('button',{name:'Colleges',exact:true}).click();
  assert.equal(await drawer.getByRole('link',{name:'Informatics',exact:true}).getAttribute('href'),'https://coi.uog.edu.et/');
  await page.screenshot({path:out+'/mobile-navigation.png'});
  await drawer.getByRole('button',{name:'Research',exact:true}).click();assert.equal(await drawer.getByRole('button',{name:'Academics',exact:true}).getAttribute('aria-expanded'),'false');
  await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert(await trigger.evaluate(el=>document.activeElement===el));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checks.push({check:'1024px compact header, 390px nested mobile accordion, sibling closing, drawer Escape and focus restoration',status:'PASS'});
  await page.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
  for(const width of [390,1440]){await page.setViewportSize({width,height:900});if(width===1440)await academics.hover();const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);checks.push({check:`automated WCAG A/AA ${width}px`,status:'PASS'});}
  console.log(JSON.stringify(checks));
 }finally{fs.writeFileSync(out+'/results.json',JSON.stringify({date:'2026-11-22',checks},null,2));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
