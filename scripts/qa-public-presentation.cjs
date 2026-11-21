const {chromium}=require('./perf/node_modules/playwright-core');
const fs=require('node:fs');
const path=require('node:path');
// Anonymous, read-only checks against the actual host-resolved public sites.
(async()=>{
 const out=process.env.UOG_PUBLIC_REVIEW_OUTPUT||'.git/task-data/public-design';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.UOG_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const results=[];
 try {
  for(const host of ['coi.uog.local','www.uog.local','caes.uog.local'])for(const width of [390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.goto(`http://${host}`,{waitUntil:'networkidle'});
   console.log(`Checking ${host} at ${width}`);
   await page.locator('article').first().waitFor({timeout:30000}).catch(async error=>{await page.screenshot({path:path.join(out,'loading-error.png'),fullPage:true});console.log(await page.locator('body').innerText());throw error;});
   const check=await page.evaluate(()=>({site:document.querySelector('[data-public-site]')?.getAttribute('data-site-name'),overflow:document.documentElement.scrollWidth>innerWidth,headers:document.querySelectorAll('header').length,footers:document.querySelectorAll('footer').length,h1:document.querySelectorAll('h1').length}));
   if(check.overflow||check.headers!==1||check.footers!==1||check.h1!==1)throw Error(JSON.stringify({host,width,...check}));
   if(width<900){const trigger=page.getByRole('button',{name:'Open site header',exact:true});if(await trigger.count()){
    await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close site header',exact:true}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(400);if(!await trigger.evaluate(el=>document.activeElement===el))throw Error('Drawer focus restoration failed');
   }}else{
    const links=page.locator('header nav[aria-label="Site header desktop"] > ul > li');
    if(await links.count()>1){const positions=await links.evaluateAll(nodes=>nodes.map(x=>x.getBoundingClientRect().top));if(Math.max(...positions)-Math.min(...positions)>2)throw Error('Desktop primary links are not horizontal');}
   }
   await page.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
   const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,html:n.html}))})));
   results.push({host,width,...check,violations});
   await page.screenshot({path:path.join(out,`${host}-${width}.png`),fullPage:true});await page.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(x=>x.violations.length))process.exitCode=1;
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
