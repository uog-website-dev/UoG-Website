const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')), output='docs/qa/menu-directory-2026-11-14';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);
 const results=[];const pass=name=>results.push({name,status:'PASS'});
 try {
 await page.goto('http://localhost/admin',{timeout:120000});
 await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
 await page.locator('#username').fill(seed.member.username);await page.locator('#password').fill(seed.member.password);await page.locator('#kc-login').click();
 await page.waitForURL(u=>u.origin==='http://localhost'&&u.pathname.startsWith('/admin'),{timeout:120000});
 await page.goto(`http://localhost/admin/sites/${seed.site}/admin/menus`,{timeout:120000});
 await page.getByRole('textbox',{name:'New menu name',exact:true}).waitFor();
 for(const name of ['Student services','Research navigation']) {
 await page.getByRole('textbox',{name:'New menu name',exact:true}).fill(name);
 await page.getByRole('button',{name:'Create menu',exact:true}).click();
 await page.getByRole('button',{name:new RegExp(name+' / ')}).waitFor();
 }
 pass('Site Administrator creates two unassigned named menus alongside existing navigation');
 await page.getByRole('button',{name:/Student services \/ student-services/}).click();
 await page.getByRole('button',{name:'Edit Student services',exact:true}).click();
 await page.getByRole('textbox',{name:'Local menu name',exact:true}).fill('Student information');
 await page.getByRole('button',{name:'Save menu',exact:true}).click();
 await page.getByRole('button',{name:/Student information \/ student-services/}).waitFor();
 pass('Rename retains the stable identifier and directory selection');
 await page.getByRole('button',{name:'Publish Student information',exact:true}).click();
 await page.getByRole('button',{name:'Retire Student information',exact:true}).click();
 await page.getByRole('button',{name:'Publish Student information',exact:true}).waitFor();
 pass('Publish and retire retain the menu in the directory');
 await page.getByRole('textbox',{name:'Search menu directory',exact:true}).fill('research');
 await page.getByRole('button',{name:'Edit Research navigation',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Student information \/ student-services/}).count(),0);
 pass('Directory search selects the matching menu');
 await page.getByRole('textbox',{name:'Search menu directory',exact:true}).fill('');
 await page.getByText('Loading selected menu...', {exact:true}).waitFor({state:'hidden'});
 await page.screenshot({path:output+'/directory-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:900});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.getByRole('textbox',{name:'Search menu directory',exact:true}).focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BUTTON');
 pass('Phone-width directory has no overflow and menu choices are keyboard reachable');
 await page.screenshot({path:output+'/directory-mobile.png',fullPage:true});
 }catch(error){await page.screenshot({path:output+'/browser-failure.png',fullPage:true});results.push({name:error.message,status:'FAIL'});throw error;}
 finally {fs.writeFileSync(output+'/browser-results.json',JSON.stringify({results},null,2));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
