/* Real Edge onboarding: Site Admin -> create -> avatar directory -> user login. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8'));
 const out='docs/qa/site-user-create-2026-11-13';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 const results=[];const pass=name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
 async function login(page,actor){
  await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
  await page.locator('#username').fill(actor.username);await page.locator('#password').fill(actor.password);await page.locator('#kc-login').click();
  // The realm requires first/last names on first login; honor that existing
  // profile-completion policy rather than marking email verified or bypassing it.
  const profile=await page.locator('#firstName').waitFor({timeout:10000}).then(()=>true).catch(()=>false);
  if(profile){await page.locator('#firstName').fill('QA');await page.locator('#lastName').fill('Staff');await page.locator('button[type="submit"],input[type="submit"]').click();}
  await page.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'),{timeout:90000});
 }
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();page.setDefaultTimeout(60000);
 try {
  await login(page,seed.admin);
  await page.goto(`http://localhost/admin/sites/${seed.site}/admin/users`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Create user',exact:true});await dialog.waitFor();
  await dialog.getByRole('textbox',{name:/^Username/}).fill(seed.staff.username);
  await dialog.getByRole('textbox',{name:/^Email/}).fill(seed.staff.email);
  await dialog.getByLabel(/^Password/).fill(seed.staff.password);
  await dialog.getByLabel(/^Confirm password/).fill(seed.staff.password);
  await dialog.locator('input[type=file]').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:Buffer.from(seed.picture,'base64')});
  await dialog.getByRole('combobox',{name:/Site role/}).click();
  assert.equal(await page.getByRole('option',{name:'Platform Administrator',exact:true}).count(),0);
  await page.getByRole('option',{name:'Editor',exact:true}).click();
  await page.screenshot({path:out+'/desktop-form.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await dialog.evaluate(node=>node.getBoundingClientRect().width<=window.innerWidth));
  await page.screenshot({path:out+'/mobile-form.png',fullPage:true});
  await page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});
  const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('[role=dialog]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact})));
  fs.writeFileSync(out+'/accessibility.json',JSON.stringify(violations,null,2));assert.equal(violations.length,0);
  pass('Accessible responsive form, optional picture and Site-only role options');
  await dialog.getByRole('button',{name:'Create user',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const row=page.getByRole('row').filter({hasText:seed.staff.username});await row.waitFor();
  assert((await row.innerText()).includes('Editor'));
  const avatar=row.locator('img');await avatar.evaluate(node=>node.decode());
  assert((await avatar.getAttribute('src')).startsWith('data:image/jpeg;base64,'));
  await page.setViewportSize({width:1440,height:1050});
  await page.screenshot({path:out+'/directory.png',fullPage:true});
  pass('Create user completes and directory shows role and normalized profile image');
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await dialog.getByRole('textbox',{name:/^Username/}).fill(seed.staff.username);
  await dialog.getByRole('textbox',{name:/^Email/}).fill(seed.staff.email);
  await dialog.getByLabel(/^Password/).fill(seed.staff.password);await dialog.getByLabel(/^Confirm password/).fill(seed.staff.password);
  await dialog.getByRole('combobox',{name:/Site role/}).click();await page.getByRole('option',{name:'Editor',exact:true}).click();
  await dialog.getByRole('button',{name:'Create user',exact:true}).click();
  await dialog.getByText('This username is already registered. Use Add existing user.',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:/^Email/}).inputValue(),seed.staff.email);
  pass('Duplicate account returns field errors without losing form input');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const staffContext=await browser.newContext();const staffPage=await staffContext.newPage();staffPage.setDefaultTimeout(60000);
  await login(staffPage,seed.staff);
  await staffPage.goto(`http://localhost/admin/sites/${seed.site}/admin`,{waitUntil:'domcontentloaded',timeout:90000});
  await staffPage.getByRole('heading',{level:1}).waitFor();
  assert((await staffPage.locator('body').innerText()).includes('Staff onboarding'));
  await staffPage.screenshot({path:out+'/new-user-site-access.png',fullPage:true});
  pass('New account signs in with provided credentials and reaches its Site workspace');
 } catch(error){results.push({name:'Live onboarding',status:'FAIL',error:error.message.replace(/http[^ ]+/g,'[url]').slice(0,400)});console.error(error.message.replace(/http[^ ]+/g,'[url]').slice(0,400));console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-1300));process.exitCode=1;}
 finally {fs.writeFileSync(out+'/browser-results.json',JSON.stringify({run:seed.run,browser:browser.version(),results},null,2));await browser.close();}
})();
