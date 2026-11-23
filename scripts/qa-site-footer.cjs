const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('./perf/node_modules/playwright-core');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),profile=seed.profiles.college,id=seed.sites.college;
 const out='.git/task-data/footer-review';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 let page,original,changed=false;
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(60000);
 await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
 await page.locator('#username').fill(profile.username);await page.locator('#password').fill(profile.password);await page.locator('#kc-login').click();
 await page.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'));
 await page.goto(`http://localhost/admin/sites/${id}/admin/footer`,{waitUntil:'domcontentloaded'});
 const input=page.getByRole('textbox',{name:'Short description',exact:true});await input.waitFor();original=await input.inputValue();
 await input.fill('Footer QA: shared Site administration');
 await page.getByRole('button',{name:'Save footer',exact:true}).click();await page.getByText(/Footer saved for this Site/).waitFor();changed=true;
 const publicPage=await context.newPage();await publicPage.goto('http://coi.uog.local',{waitUntil:'networkidle'});
 await publicPage.getByRole('contentinfo').getByText('Footer QA: shared Site administration',{exact:true}).waitFor();
 const peer=await context.newPage();await peer.goto('http://www.uog.local',{waitUntil:'networkidle'});assert.equal(await peer.getByText('Footer QA: shared Site administration',{exact:true}).count(),0);
 await page.screenshot({path:out+'/admin-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/admin-mobile.png',fullPage:true});
 await page.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
 const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(x=>({id:x.id,impact:x.impact})));
 assert.deepEqual(violations,[]);
 fs.writeFileSync(out+'/result.json',JSON.stringify({site:id,saveAndPublicDelivery:true,mainUnchanged:true,mobileOverflow:false,violations},null,2));console.log('Footer editor save, scoped public delivery, mobile and accessibility passed');
 }finally{
 if(changed&&page){await page.getByRole('textbox',{name:'Short description',exact:true}).fill(original);await page.getByRole('button',{name:'Save footer',exact:true}).click();await page.getByText(/Footer saved for this Site/).waitFor();console.log('Restored original footer description');}
 await browser.close();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
