const fs=require('node:fs'), assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),output='docs/qa/menu-destinations-2026-11-14';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 const results=[],pass=name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
 const read=host=>new Promise((resolve,reject)=>http.get('http://localhost/api/v1/site-context/menus/?location=header',{headers:{Host:host}},response=>{let s='';response.on('data',c=>s+=c);response.on('end',()=>{try{assert.equal(response.statusCode,200);resolve(JSON.parse(s).locations.header);}catch(e){reject(e);}});}).on('error',reject));
 let page;
 async function login(member){const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(60000);for(let n=0;n<20;n++){const response=await page.goto('http://localhost/admin',{timeout:120000});if(response.status()<500)break;await page.waitForTimeout(2000);}await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill(member.username);await page.locator('#password').fill(member.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin==='http://localhost'&&u.pathname.startsWith('/admin'),{timeout:120000});await page.goto(`http://localhost/admin/sites/${seed.site}/admin/menus`,{timeout:120000});await page.getByRole('form',{name:'Add to Institution navigation'}).waitFor();}
 try{
 const before=await read(seed.host),other=await read(seed.other_host);
 await login(seed.member);
 const form=page.getByRole('form',{name:'Add to Institution navigation'});
 async function add(label,kind,value){await form.getByRole('textbox',{name:'Item label'}).fill(label);await form.getByLabel('Item target',{exact:true}).selectOption(kind);if(kind==='page')await form.getByLabel('Page',{exact:true}).selectOption({label:value});if(kind==='category')await form.getByLabel('News category',{exact:true}).selectOption({label:value});if(kind==='external')await form.getByRole('textbox',{name:'External URL',exact:true}).fill(value);await form.getByRole('button',{name:'Add link',exact:true}).click();await page.getByRole('listitem',{name:label,exact:true}).waitFor();await page.getByText('Loading selected menu...', {exact:true}).waitFor({state:'hidden'});}
 await add('About institution','page','About the institution');
 await add('University news','news');
 await add('Research news','category','Research');
 await add('Partner institution','external','https://www.example.org/');
 pass('Editor adds published same-Site Page, news listing, category and safe external destinations');
 await page.getByRole('button',{name:'Nest Partner institution',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Move Partner institution out"]')?.disabled===false);
 await page.getByRole('button',{name:'Move University news up',exact:true}).focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>{const labels=[...document.querySelectorAll('[aria-label="Menu items"] > li')].map(el=>el.getAttribute('aria-label'));return labels.indexOf('University news')<labels.indexOf('About institution');});
 assert.deepEqual(await read(seed.host),before);assert.deepEqual(await read(seed.other_host),other);
 assert.equal(await page.getByRole('button',{name:'Publish changes to Institution navigation',exact:true}).count(),0);
 pass('Keyboard reorder and nesting remain private; Editor cannot publish and second Site stays unchanged');
 await page.screenshot({path:output+'/editor-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:output+'/editor-mobile.png',fullPage:true});pass('Menu editor fits phone width without horizontal overflow');
 await login(seed.publisher);
 await page.getByRole('button',{name:'Publish changes to Institution navigation',exact:true}).click();
 await page.getByRole('button',{name:'Publish changes to Institution navigation',exact:true}).waitFor({state:'hidden'});
 const published=await read(seed.host);assert.equal(published[1].label,'University news');assert.equal(published.find(r=>r.label==='Research news').children[0].label,'Partner institution');assert(published.some(r=>r.href==='/about-institution'));assert.deepEqual(await read(seed.other_host),other);
 pass('Publisher promotes the reviewed ordered tree and public nested navigation without changing the other Site');
 await page.screenshot({path:output+'/publisher-desktop.png',fullPage:true});
 }catch(error){results.push({name:error.message,status:'FAIL'});if(page)await page.screenshot({path:output+'/browser-failure.png',fullPage:true});throw error;}
 finally{fs.writeFileSync(output+'/browser-results.json',JSON.stringify({results},null,2));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
