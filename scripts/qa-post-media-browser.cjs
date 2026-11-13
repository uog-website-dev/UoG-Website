/* Real browser article media workflow. Credentials arrive on stdin. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
  const output = path.resolve('docs/qa/post-media-2026-11-13');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'],
  });
  const context = await browser.newContext({viewport:{width:1440,height:1100}});
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const results = [];
  let step = 'Login';
  const browserRun = seed.run + '-' + Date.now().toString(36);
  const title = 'Browser media ' + browserRun;
  const pass = name => { results.push({name,status:'PASS'}); console.log(name + ' PASS'); };
  try {
    await page.goto('http://localhost/admin',{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
    await page.locator('#username').fill(seed.profiles.author.username);
    await page.locator('#password').fill(seed.profiles.author.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'),{timeout:90000});
    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/posts`,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('table',{name:'Posts for this Site'}).waitFor();
    await page.getByRole('link',{name:'Create Post',exact:true}).click();
    await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
    await page.getByRole('textbox',{name:'Permalink slug',exact:true}).fill('browser-media-'+browserRun);
    const body = page.getByRole('textbox',{name:'Article body',exact:true});
    await body.fill('University media report');
    step = 'Featured picker';
    await page.getByRole('button',{name:'Choose featured image',exact:true}).click();
    await page.getByRole('button',{name:'Select review.png',exact:true}).click();
    await page.getByRole('textbox',{name:'Featured image alternative text',exact:true}).fill('Featured campus gardens');
    const featured = page.getByRole('img',{name:'Featured campus gardens',exact:true});
    await featured.waitFor();
    await featured.evaluate(img => img.decode());
    pass('Featured image picker and private delivery');
    step = 'Inline picker';
    await body.focus();
    await page.keyboard.press('Control+End');
    await page.getByRole('button',{name:'Insert image',exact:true}).click();
    await page.getByRole('button',{name:'Select review.png',exact:true}).click();
    await page.getByRole('textbox',{name:'Image alternative text',exact:true}).fill('Inline campus gardens');
    await page.getByRole('dialog',{name:'Insert article image',exact:true}).getByRole('button',{name:'Insert image',exact:true}).click();
    await body.locator('img').waitFor();
    await body.locator('img').evaluate(img => img.decode());
    await page.screenshot({path:path.join(output,'editor-media.png'),fullPage:true});
    await page.getByRole('button',{name:'Save Draft',exact:true}).click();
    await page.waitForURL(`**/admin/sites/${seed.site}/admin/posts`);
    await page.getByRole('link',{name:'Edit '+title,exact:true}).click();
    await body.locator('img[alt="Inline campus gardens"]').waitFor();
    await body.locator('img').evaluate(img => img.decode());
    assert.equal(await page.getByRole('textbox',{name:'Featured image alternative text',exact:true}).inputValue(),'Featured campus gardens');
    pass('Inline image and alternative text round trip');
    step = 'Featured removal';
    await page.getByRole('button',{name:'Remove featured image',exact:true}).click();
    await page.getByRole('button',{name:'Save Draft',exact:true}).click();
    await page.waitForURL(`**/admin/sites/${seed.site}/admin/posts`);
    await page.getByRole('link',{name:'Edit '+title,exact:true}).click();
    await page.getByText('No featured image selected.',{exact:true}).waitFor();
    await body.locator('img').evaluate(img => img.decode());
    pass('Featured removal retains shared inline image');
    step = 'Mobile accessibility';
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Insert image',exact:true}).focus();
    assert.equal(await page.getByRole('button',{name:'Insert image',exact:true}).evaluate(node=>node===document.activeElement),true);
    await page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});
    const violations = await page.evaluate(async () => (await axe.run(document.querySelector('main') || document.body,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})));
    fs.writeFileSync(path.join(output,'accessibility.json'),JSON.stringify(violations,null,2));
    assert.equal(violations.length,0);
    await page.screenshot({path:path.join(output,'editor-media-mobile.png'),fullPage:true});
    pass('Mobile keyboard and automated accessibility');
    step = 'Published images';
    const publicPage = await context.newPage();
    await publicPage.goto(`http://${seed.media.host}/posts/${seed.media.slug}`,{waitUntil:'domcontentloaded',timeout:90000});
    await publicPage.getByRole('img',{name:'Campus gardens',exact:true}).first().waitFor();
    assert.equal(await publicPage.getByRole('img',{name:'Campus gardens',exact:true}).count(),2);
    for (const image of await publicPage.getByRole('img',{name:'Campus gardens',exact:true}).all()) await image.evaluate(img=>img.decode());
    await publicPage.screenshot({path:path.join(output,'public-images.png'),fullPage:true});
    pass('Published featured and inline image delivery');
  } catch (error) {
    results.push({name:step,status:'FAIL',error:error.message.replace(/http[^ ]+/g,'[url]').slice(0,500)});
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    console.error(step + ' failed. ' + error.message.replace(/http[^ ]+/g,'[url]').slice(0,500));
    process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({run:seed.run,site:seed.site,browser:browser.version(),results},null,2));
    await browser.close();
  }
})();
