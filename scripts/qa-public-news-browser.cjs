/* Anonymous real-browser news acceptance with controlled transport faults. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async()=>{
  const seed=JSON.parse(fs.readFileSync(0,'utf8'));
  const output=path.resolve('docs/qa/public-news-2026-11-13');
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  const root=`http://${seed.news.host_a}/posts`;
  const results=[];
  let step='Loading and cards';
  const pass=name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
  const ready=number=>page.getByText(`Page ${number} | 23 articles`,{exact:true}).waitFor();
  try {
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const delay=async route=>{await gate;await route.continue().catch(()=>{});};
    await page.route('**/api/v1/site-context/posts/**',delay);
    await page.goto(root,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByText('Loading news...',{exact:true}).waitFor();
    release();
    await ready(1);
    await page.unroute('**/api/v1/site-context/posts/**',delay);
    const cards=page.locator('[data-testid="public-post-feed"] > li');
    assert.equal(await cards.count(),20);
    const image=page.getByRole('img',{name:'Campus gardens',exact:true});
    await image.evaluate(node=>node.decode());
    assert.equal(await page.locator('[data-testid="public-post-feed"] time').count(),20);
    const firstLinks=await page.locator('[data-testid="public-post-feed"] a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    assert(firstLinks.every(href=>href.startsWith('/posts/')&&!href.includes('site=')));
    await page.screenshot({path:path.join(output,'news-desktop.png'),fullPage:true});
    pass('Loading state, twenty scoped cards, dates and approved thumbnail');

    step='Pagination and keyboard';
    await page.getByRole('button',{name:'Next page',exact:true}).click();
    await ready(2);
    assert.equal(await cards.count(),3);
    const secondLinks=await page.locator('[data-testid="public-post-feed"] a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    assert(secondLinks.every(href=>!firstLinks.includes(href)));
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Previous page',exact:true}).focus();
    await page.keyboard.press('Enter');
    await ready(1);
    await page.waitForFunction(()=>document.activeElement?.textContent==='News');
    const columns=await page.locator('[data-testid="public-post-feed"]').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns,1);
    await page.screenshot({path:path.join(output,'news-mobile.png'),fullPage:true});
    await page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});
    const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('[aria-busy]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})));
    fs.writeFileSync(path.join(output,'accessibility.json'),JSON.stringify(violations,null,2));
    assert.equal(violations.length,0);
    await page.setViewportSize({width:768,height:1000});
    assert.equal(await page.locator('[data-testid="public-post-feed"]').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
    await page.screenshot({path:path.join(output,'news-tablet.png'),fullPage:true});
    pass('Stable pagination, mobile keyboard focus and responsive accessibility');

    step='Same-Site detail link';
    await page.getByRole('link',{name:'Published image article',exact:true}).click();
    await page.getByRole('heading',{name:'Published image article',exact:true}).waitFor();
    assert.equal(new URL(page.url()).host,seed.news.host_a);
    pass('Card opens the approved article on the same hostname');

    step='Independent and empty catalogs';
    await page.goto(`http://${seed.news.host_b}/posts`,{waitUntil:'domcontentloaded'});
    await page.getByRole('link',{name:'Central Site update',exact:true}).waitFor();
    assert.equal(await cards.count(),1);
    assert.equal(await page.getByRole('link',{name:'Published image article',exact:true}).count(),0);
    await page.goto(`http://${seed.news.host_empty}/posts`,{waitUntil:'domcontentloaded'});
    await page.getByText('This Site has no published posts to show.',{exact:true}).waitFor();
    await page.goto(`http://${seed.news.host_disabled}/posts`,{waitUntil:'domcontentloaded'});
    await page.getByText('News is not available for this Site.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Disabled private marker',{exact:true}).count(),0);
    pass('University-owned, child, empty and disabled Site catalogs stay independent');

    step='Failure recovery';
    const fail=route=>route.abort('failed');
    await page.route('**/api/v1/site-context/posts/**',fail);
    await page.goto(root,{waitUntil:'domcontentloaded'});
    await page.getByRole('alert').filter({hasText:'News is temporarily unavailable'}).waitFor();
    assert.equal(await cards.count(),0);
    await page.unroute('**/api/v1/site-context/posts/**',fail);
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await ready(1);
    pass('Transport failure exposes a retry and recovers without stale cards');

    step='Missing thumbnail';
    const noImage=route=>route.fulfill({status:404,body:''});
    await page.route('**/api/v1/site-context/media/**',noImage);
    await page.reload({waitUntil:'domcontentloaded'});
    await ready(1);
    await page.getByRole('link',{name:'Published image article',exact:true}).scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>!document.querySelector('[data-testid="public-post-feed"] img'));
    assert.equal(await page.locator('[data-testid="public-post-feed"]').getByRole('img',{name:'No image available',exact:true}).count(),20);
    await page.unroute('**/api/v1/site-context/media/**',noImage);
    pass('Missing media uses the card fallback and retains its article link');

    step='Stale filter request';
    let releaseOld;
    let markStarted;
    const started=new Promise(resolve=>{markStarted=resolve;});
    const old=new Promise(resolve=>{releaseOld=resolve;});
    const delayed=async route=>{
      if (!new URL(route.request().url()).searchParams.has('category')) {markStarted();await old;}
      await route.continue().catch(()=>{});
    };
    await page.route('**/api/v1/site-context/posts/**',delayed);
    await page.goto(root,{waitUntil:'domcontentloaded'});
    await page.getByText('Loading news...',{exact:true}).waitFor();
    await started;
    await page.getByRole('textbox',{name:'Category',exact:true}).fill('missing-category');
    await page.getByRole('button',{name:'Apply',exact:true}).click();
    await page.waitForURL(url=>url.searchParams.get('category')==='missing-category');
    await page.getByText('This Site has no published posts to show.',{exact:true}).waitFor();
    releaseOld();
    await page.unroute('**/api/v1/site-context/posts/**',delayed);
    assert.equal(await cards.count(),0);
    assert.equal(await page.getByRole('textbox',{name:'Category',exact:true}).inputValue(),'missing-category');
    pass('A cancelled earlier request cannot replace the active filtered catalog');

    step='Invalid pagination recovery';
    await page.goto(root+'?page_size=101',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Return to first page',exact:true}).click();
    await ready(1);
    pass('Invalid page size has a usable first-page recovery');
  } catch(error) {
    results.push({name:step,status:'FAIL',error:error.message.replace(/http[^ ]+/g,'[url]').slice(0,500)});
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    console.error(step+' failed. '+error.message.replace(/http[^ ]+/g,'[url]').slice(0,500));
    process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({run:seed.run,browser:browser.version(),results},null,2));
    await browser.close();
  }
})();
