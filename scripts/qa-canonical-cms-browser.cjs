/* Real browser role handoff and revocation; service credentials remain on stdin. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const s=JSON.parse(fs.readFileSync(0,'utf8')),out='docs/qa/P0-USER-002';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const rows=[];const pass=name=>{rows.push({name,status:'PASS'});console.log(name+' PASS');};
 const root='http://localhost/api/v1/authorization/assignments/';let assignment=s.assignment;
 async function role(code){
  assert.equal((await context.request.post(root+assignment+'/revoke/',{headers:{Authorization:'Bearer '+s.root_token},data:{}})).status(),200);
  if(code){const response=await context.request.post(root,{headers:{Authorization:'Bearer '+s.root_token},data:{user:s.member_id,role:s.roles[code],scope:'SITE',site:s.site,organization:s.organization}});assert.equal(response.status(),201);assignment=(await response.json()).id;}
 }
 async function posts(){await page.goto(`http://localhost/admin/sites/${s.site}/admin/posts`,{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('table',{name:'Posts for this Site',exact:true}).waitFor();}
 try{
  await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
  await page.locator('#username').fill(s.member.username);await page.locator('#password').fill(s.member.password);await page.locator('#kc-login').click();
  await page.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'),{timeout:90000});
  await posts();await page.getByRole('button',{name:'Submit Canonical draft for review',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve Canonical review',exact:true}).count(),0);
  pass('Editor membership alone opens Posts and offers author actions');
  await role('reviewer');await posts();await page.getByRole('button',{name:'Approve Canonical review',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Create Post',exact:true}).count(),0);
  await page.screenshot({path:out+'/reviewer-controls.png',fullPage:true});pass('Role change exposes review controls without a legacy grant');
  await role('publisher');await posts();await page.getByRole('button',{name:'Publish Canonical approved',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve Canonical review',exact:true}).count(),0);
  await page.screenshot({path:out+'/publisher-controls.png',fullPage:true});pass('Publisher membership offers publish controls and excludes review');
  await page.goto(`http://localhost/admin/sites/${s.other}/admin/posts`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByText('This Site is not available to your account.',{exact:false}).waitFor();pass('Foreign Site workspace stays inaccessible');
  await role(null);await page.goto(`http://localhost/admin/sites/${s.site}/admin/posts`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByText('This Site is not available to your account.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('table',{name:'Posts for this Site',exact:true}).count(),0);
  await page.screenshot({path:out+'/revoked-access.png',fullPage:true});pass('Revocation removes CMS access in the same signed-in session');
 }catch(error){rows.push({name:'Canonical browser regression',status:'FAIL',error:error.message.replace(/http[^ ]+/g,'[url]').slice(0,400)});console.error(error.message.replace(/http[^ ]+/g,'[url]').slice(0,400));process.exitCode=1;}
 finally{fs.writeFileSync(out+'/browser-results.json',JSON.stringify({run:s.run,browser:browser.version(),results:rows},null,2));await browser.close();}
})();
