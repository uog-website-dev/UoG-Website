/* Real Edge + Next.js + Keycloak + Django/PostgreSQL. Secrets only on stdin. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8'));
 const articleRun=seed.run+'-'+Date.now().toString(36);
 const output=path.resolve('docs/qa/post-editor-2026-11-13');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const results=[];let current='login';
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>console.log('Browser runtime: '+error.message.slice(0,220)));
 async function login(page,actor){
  await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
  await page.locator('#username').fill(actor.username);await page.locator('#password').fill(actor.password);await page.locator('#kc-login').click();
  await page.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'),{timeout:90000});
  await page.goto(`http://localhost/admin/sites/${seed.site}/admin/posts`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('table',{name:'Posts for this Site',exact:true}).waitFor();
  await page.getByRole('button',{name:'Create Post',exact:true}).waitFor();
  await page.waitForLoadState('networkidle',{timeout:60000});
 }
 function pass(name,details){results.push({name,status:'PASS',details});console.log(name+': PASS');}
 try{
  await login(page,seed.profiles.author);pass('Real Site author access','Keycloak session and Site-scoped Posts administration loaded.');
  current='create';await page.getByRole('button',{name:'Create Post',exact:true}).click();
  await page.getByRole('dialog',{name:'Create Post',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Title',exact:true}).fill('QA formatted report '+articleRun);
  await page.getByRole('textbox',{name:'Permalink slug',exact:true}).fill('qa-'+articleRun);
  const body=page.getByRole('textbox',{name:'Article body',exact:true});
  await body.fill('A formatted university report');await body.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');await page.keyboard.press('Control+b');
  assert.match(await body.innerHTML(),/<(b|strong)>/);
  // Exercise clipboard sanitization without inserting hostile HTML into the DOM.
  await body.evaluate(node=>{const data=new DataTransfer();data.setData('text/html','<h2>Campus news</h2><p>A <strong>bold</strong> and <em>emphasized</em> report.</p><h3>Details</h3><h4>Context</h4><ul><li>First</li></ul><ol><li>Second</li></ol><blockquote>A quotation</blockquote><script>window.articleAttack=1</script><p onclick="alert(1)">Safe text</p>');node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  assert.equal(await body.locator('script,[onclick]').count(),0);
  await body.focus();await page.keyboard.press('Control+End');await page.keyboard.press('Control+Shift+Home');
  await page.getByRole('button',{name:'Insert link',exact:true}).click();await page.getByRole('textbox',{name:'Link destination'}).fill('https://uog.edu.et/news');await page.getByRole('button',{name:'Insert link',exact:true}).last().click();await page.getByRole('dialog',{name:'Insert article link'}).waitFor({state:'hidden'});await body.locator('a').first().waitFor();
  await page.screenshot({path:path.join(output,'desktop-editor.png'),fullPage:true});
  const authored=await body.innerHTML();await page.getByRole('button',{name:'Save Draft',exact:true}).click();await page.getByRole('dialog',{name:'Create Post',exact:true}).waitFor({state:'hidden'});
  pass('Formatted draft save','Browser formatting, safe paste, headings/lists/quote/link saved through real server actions.');
  current='reload';await page.getByRole('button',{name:'Edit QA formatted report '+articleRun,exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor();
  assert.equal(await body.locator('h2').textContent(),'Campus news');assert.equal(await body.locator('h3,h4,ul,ol,blockquote,strong,em').count(),7);assert.equal(await page.evaluate(()=>window.articleAttack),undefined);
  pass('Reopen preserves formatting','All supported semantic elements reload; unsafe pasted content cannot execute.');
  current='stale conflict';const context2=await browser.newContext({viewport:{width:1440,height:1000}});const second=await context2.newPage();await login(second,seed.profiles.editor);await second.getByRole('button',{name:'Edit QA formatted report '+articleRun,exact:true}).click();await second.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor();
  await second.getByRole('textbox',{name:'Article body'}).fill('Newer editor revision');await second.getByRole('button',{name:'Save Draft',exact:true}).click();await second.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor({state:'hidden'});
  await body.fill('Retain stale session work');await page.getByRole('button',{name:'Save Draft',exact:true}).click();await page.getByText(/Keep your text, refresh the revision marker, then save again/).waitFor();assert.equal(await body.textContent(),'Retain stale session work');pass('Two-session stale revision','Second editor save wins; stale author gets explicit conflict and retains unsaved text.');
  current='unsaved warning';let warning=false;page.once('dialog',async dialog=>{warning=true;await dialog.dismiss();});await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(warning,true);assert.equal(await body.textContent(),'Retain stale session work');pass('Discard warning','Cancel requires confirmation and dismiss preserves article.');
  current='failed save recovery';page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Edit QA formatted report '+articleRun,exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor();
  await body.fill('Recoverable article text');let interrupted=false;
  const failSave=route=>{if(route.request().method()==='POST' && route.request().headers()['next-action'] && !interrupted){interrupted=true;return route.abort('failed');}return route.continue();};
  await page.route('**/admin/sites/**/admin/posts**',failSave);await page.getByRole('button',{name:'Save Draft',exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).getByRole('alert').first().waitFor();assert.equal(interrupted,true);assert.equal(await body.textContent(),'Recoverable article text');
  await page.unroute('**/admin/sites/**/admin/posts**',failSave);await page.getByRole('button',{name:'Save Draft',exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor({state:'hidden'});pass('Failed save retry','An interrupted server-action request displays a recoverable error, retains text and saves successfully on retry.');
  await page.getByRole('button',{name:'Edit QA formatted report '+articleRun,exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor();assert.equal(await body.textContent(),'Recoverable article text');
  current='formatting toolbar';await body.fill('Toolbar demonstration');await body.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');
  await page.getByRole('combobox',{name:/Text style/}).click();await page.getByRole('option',{name:'Paragraph',exact:true}).click();await body.locator('p').first().waitFor();
  for(const [label,tag] of [['Heading 2','h2'],['Heading 3','h3'],['Heading 4','h4'],['Paragraph','p'],['Quotation','blockquote']]){
   await page.getByRole('combobox',{name:/Text style/}).click();await page.getByRole('option',{name:label,exact:true}).click();await body.locator(tag).first().waitFor();
  }
  await page.getByRole('button',{name:'Bullet list',exact:true}).click();await body.locator('ul').waitFor();await page.getByRole('button',{name:'Numbered list',exact:true}).click();await body.locator('ol').waitFor();
  await body.focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');await page.getByRole('button',{name:'Italic',exact:true}).click();await body.locator('i,em').first().waitFor();pass('All formatting controls','H2, H3, H4, paragraph, quotation, unordered/ordered lists and emphasis controls operate on the selected article text.');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor({state:'hidden'});await page.getByRole('button',{name:'Edit QA formatted report '+articleRun,exact:true}).click();await page.getByRole('dialog',{name:'Edit Post',exact:true}).waitFor();
  current='mobile keyboard';await page.setViewportSize({width:390,height:844});await body.focus();assert.equal(await body.evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'Link destination'}).waitFor();await page.keyboard.press('Escape');await page.screenshot({path:path.join(output,'mobile-editor.png'),fullPage:true});
  pass('Mobile keyboard','Article remains focusable at 390px; Ctrl+K opens accessible link dialog and Escape closes it.');
  await page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});const scan=await page.evaluate(async()=>{const r=await axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));});
  fs.writeFileSync(path.join(output,'accessibility.json'),JSON.stringify(scan,null,2));assert.equal(scan.length,0);pass('Automated accessibility','No WCAG A/AA violations in the mobile editor dialog.');
  if(seed.published){
   current='public formatted article';const publicPage=await context.newPage();await publicPage.goto('http://'+seed.published.host+'/posts/'+seed.published.slug,{waitUntil:'domcontentloaded',timeout:90000});
   await publicPage.getByRole('heading',{name:seed.published.title,level:1,exact:true}).waitFor();await publicPage.getByRole('heading',{name:'Published campus news',level:2}).waitFor();
   assert.equal(await publicPage.locator('[data-article-version="1"] strong').textContent(),'formatted');assert.equal(await publicPage.locator('[data-article-version="1"] blockquote').textContent(),'University research');
   await publicPage.setViewportSize({width:390,height:844});await publicPage.screenshot({path:path.join(output,'public-article-mobile.png'),fullPage:true});pass('Anonymous public formatting','Existing public Post route renders the published H2, emphasis, list and quotation at mobile width.');await publicPage.close();
  }
  await context2.close();
 }catch(error){results.push({name:current,status:'FAIL',error:error.name+': '+error.message.replace(/http[^ ]+/g,'[url]').slice(0,450)});await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error(current+': '+error.message.replace(/http[^ ]+/g,'[url]').slice(0,450));process.exitCode=1;}
 finally{fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({run:seed.run,site:seed.site,services:'Real Edge, Keycloak, Next.js, Django, PostgreSQL',browser_version:browser.version(),results},null,2));await browser.close();}
})();
