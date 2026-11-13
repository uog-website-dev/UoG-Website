/* Real Author, Reviewer and Publisher sessions. Credentials arrive on stdin. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const seed = JSON.parse(fs.readFileSync(0,'utf8'));
  const output = path.resolve('docs/qa/post-workflow-2026-11-13');
  const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
  const results = [];
  let step = 'Author login';
  let currentPage;
  const browserRun = seed.run+'-'+Date.now().toString(36);
  const title = 'Revised news '+browserRun;
  const marker = 'Reviewed university report '+browserRun;
  const edit = id => `http://localhost/admin/sites/${seed.site}/admin/posts/${id}/edit`;
  const pass = name => {results.push({name,status:'PASS'});console.log(name+' PASS');};
  async function login(role) {
    const context = await browser.newContext({viewport:{width:1440,height:1100}});
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
    await page.locator('#username').fill(seed.profiles[role].username);
    await page.locator('#password').fill(seed.profiles[role].password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url=>url.origin==='http://localhost'&&url.pathname.startsWith('/admin'),{timeout:90000});
    return {context,page};
  }
  async function action(page,label,action,comment) {
    await page.getByRole('button',{name:label,exact:true}).click();
    if (comment) await page.getByRole('textbox',{name:/Reviewer comment/}).fill(comment);
    await page.getByRole('button',{name:'Confirm '+action,exact:true}).click();
    await page.getByRole('dialog',{name:action[0].toUpperCase()+action.slice(1)+' Post?',exact:true}).waitFor({state:'hidden'});
  }
  try {
    const author = await login('author');
    const page = currentPage = author.page;
    await page.goto(edit(seed.media.published_post),{waitUntil:'domcontentloaded',timeout:90000});
    const originalTitle = await page.getByRole('textbox',{name:'Title',exact:true}).inputValue();
    await page.getByRole('button',{name:'Edit working draft',exact:true}).click();
    await page.waitForURL(url=>url.pathname.endsWith('/edit')&&!url.pathname.includes(seed.media.published_post),{timeout:90000});
    const draftUrl = page.url();
    await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
    const body = page.getByRole('textbox',{name:'Article body',exact:true});
    await body.fill(marker);
    await page.getByRole('button',{name:'Save Draft',exact:true}).click();
    await page.getByText("Draft saved.",{exact:true}).waitFor();
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByText(/Status:? draft/).waitFor();
    pass('Author saves a separate working draft');

    step = 'Private preview and public isolation';
    const previewLink = page.getByRole('link',{name:'Preview saved revision',exact:true});
    assert.equal(await previewLink.getAttribute('target'),'_blank');
    const [preview] = await Promise.all([
      author.context.waitForEvent('page',{timeout:90000}),
      previewLink.click({noWaitAfter:true}),
    ]);
    await preview.getByRole('heading',{name:title,exact:true}).waitFor({timeout:90000});
    assert.equal(await preview.getByText(marker,{exact:true}).count(),1);
    await preview.getByRole('img',{name:'Campus gardens',exact:true}).evaluate(img=>img.decode());
    await preview.screenshot({path:path.join(output,'private-preview.png'),fullPage:true});
    const visitor = await browser.newContext();
    const publicPage = await visitor.newPage();
    await publicPage.goto(`http://${seed.media.host}/posts/${seed.media.slug}`,{waitUntil:'domcontentloaded',timeout:90000});
    await publicPage.getByRole('heading',{name:originalTitle,exact:true}).waitFor();
    assert.equal(await publicPage.getByText(marker,{exact:true}).count(),0);
    const denied = await visitor.newPage();
    await denied.goto(preview.url(),{waitUntil:'domcontentloaded',timeout:90000});
    await denied.getByRole('button',{name:'Sign in with Keycloak',exact:true}).waitFor();
    assert.equal(await denied.getByText(marker,{exact:true}).count(),0);
    pass('New-tab preview stays private while the old publication remains public');

    step = 'Submit and reviewer rejection';
    await action(page,'Submit '+title+' for review','submit');
    await page.getByText(/Status:? in review/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Publish '+title,exact:true}).count(),0);
    const reviewer = await login('reviewer');
    currentPage = reviewer.page;
    await reviewer.page.goto(draftUrl,{waitUntil:'domcontentloaded'});
    await reviewer.page.getByRole('button',{name:'Reject '+title,exact:true}).click();
    assert.equal(await reviewer.page.getByRole('button',{name:'Confirm reject',exact:true}).isEnabled(),false);
    await reviewer.page.getByRole('textbox',{name:'Reviewer comment (required)',exact:true}).fill('Please verify the research figures.');
    await reviewer.page.getByRole('button',{name:'Confirm reject',exact:true}).click();
    await reviewer.page.getByText(/Status:? draft/).waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText(/Reviewer comment:? Please verify/).waitFor();
    assert.equal(await body.textContent(),marker);
    pass('Reviewer rejection requires a comment and preserves the draft');

    step = 'Resubmit and approve';
    await action(page,'Submit '+title+' for review','submit');
    await reviewer.page.reload({waitUntil:'domcontentloaded'});
    await action(reviewer.page,'Approve '+title,'approve','Verified and approved for release.');
    await reviewer.page.getByText(/Status:? approved/).waitFor();
    await publicPage.reload({waitUntil:'domcontentloaded'});
    await publicPage.getByRole('heading',{name:originalTitle,exact:true}).waitFor();
    pass('Approval remains private until a permitted Publisher releases it');

    step = 'Publish approved working draft';
    const publisher = await login('publisher');
    currentPage = publisher.page;
    await publisher.page.goto(draftUrl,{waitUntil:'domcontentloaded'});
    await action(publisher.page,'Publish '+title,'publish');
    await publisher.page.waitForURL(edit(seed.media.published_post));
    await publisher.page.getByText(/Status:? published/).waitFor();
    await publicPage.reload({waitUntil:'domcontentloaded'});
    await publicPage.getByRole('heading',{name:title,exact:true}).waitFor();
    await publicPage.getByText(marker,{exact:true}).waitFor();
    await publicPage.screenshot({path:path.join(output,'published-revision.png'),fullPage:true});
    const independent = await visitor.newPage();
    await independent.goto(`http://${seed.workflow.host_b}/posts/${seed.media.slug}`,{waitUntil:'domcontentloaded'});
    await independent.getByRole('heading',{name:'Independent article',exact:true}).waitFor();
    assert.equal(await independent.getByText(marker,{exact:true}).count(),0);
    pass('Publication replaces the original revision and preserves the independent Site');

    step = 'Keyboard and accessibility';
    await publisher.page.setViewportSize({width:390,height:844});
    const unpublish = publisher.page.getByRole('button',{name:'Unpublish '+title,exact:true});
    await unpublish.focus();
    assert.equal(await unpublish.evaluate(node=>node===document.activeElement),true);
    await publisher.page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});
    const violations = await publisher.page.evaluate(async()=> (await axe.run(document.querySelector('[aria-labelledby="post-editor-title"]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})));
    fs.writeFileSync(path.join(output,'accessibility.json'),JSON.stringify(violations,null,2));
    assert.equal(violations.length,0);
    await publisher.page.screenshot({path:path.join(output,'workflow-mobile.png'),fullPage:true});
    pass('Workflow controls support mobile keyboard access and accessibility scan');

    step = 'Unpublish';
    await action(publisher.page,'Unpublish '+title,'unpublish');
    await publisher.page.getByText(/Status:? unpublished/).waitFor();
    await publicPage.reload({waitUntil:'domcontentloaded'});
    await publicPage.getByText('This Site has no published post to show.',{exact:true}).waitFor();
    await independent.reload({waitUntil:'domcontentloaded'});
    await independent.getByRole('heading',{name:'Independent article',exact:true}).waitFor();
    pass('Unpublish withdraws this article and keeps the other Site public');
  } catch(error) {
    results.push({name:step,status:'FAIL',error:error.message.replace(/http[^ ]+/g,'[url]').slice(0,500)});
    await currentPage?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    console.error(step+' failed. '+error.message.replace(/http[^ ]+/g,'[url]').slice(0,500));
    process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({run:seed.run,site:seed.site,browser:browser.version(),results},null,2));
    await browser.close();
  }
})();
