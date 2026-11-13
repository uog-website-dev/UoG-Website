/* Real anonymous Edge: host-scoped category archives, cards and recovery. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const seed=JSON.parse(fs.readFileSync('docs/qa/category-archives-2026-11-13/fixtures.json','utf8').replace(/^\uFEFF/,''));
 const output='docs/qa/category-archives-2026-11-13';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(60000);
 page.setDefaultNavigationTimeout(90000);
 const root=`http://${seed.host}`;
 const archive=`${root}/posts/categories/${seed.category}`;
 const results=[];
 const pass=name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
 try {
  await page.goto(archive+'?page_size=2',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:seed.name,exact:true}).waitFor();
  const cards=page.locator('[data-testid="public-post-feed"] > li');
  assert.equal(await cards.count(),2);
  const links=await cards.locator('h2 a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  const categoryLink=cards.first().getByRole('link',{name:seed.name,exact:true});
  assert.equal(await categoryLink.getAttribute('href'),`/posts/categories/${seed.category}`);
  await page.screenshot({path:output+'/desktop.png',fullPage:true});
  pass('Published category heading, scoped cards and approved archive link');
  await page.getByRole('button',{name:'Next page',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Page 2 | 5 articles',{exact:true}).waitFor();
  const second=await cards.locator('h2 a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert(second.every(link=>!links.includes(link)));
  assert(page.url().includes(`/posts/categories/${seed.category}?page=2&page_size=2`));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('[data-testid="public-post-feed"]').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
  await page.screenshot({path:output+'/mobile.png',fullPage:true});
  pass('Stable archive pagination, keyboard operation and mobile stacking');
  await page.goto(`${root}/posts/categories/${seed.empty}`);
  await page.getByText('No published articles in this category yet. Browse all news for more updates.',{exact:true}).waitFor();
  assert.equal(await cards.count(),0);
  pass('Intentional empty archive and all-news navigation');
  for(const slug of [seed.foreign,seed.private,'unknown-category']) {
   const response=await page.request.get(`http://127.0.0.1/api/v1/site-context/posts/categories/${slug}/`,{headers:{Host:seed.host}});
   assert.equal(response.status(),404);
  }
  pass('Foreign, unpublished and unknown category API requests return 404');
  await page.goto(archive+'?page_size=101');
  await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Return to first page'}).click();
  await page.getByRole('heading',{name:seed.name,exact:true}).waitFor();
  assert.equal(await cards.count(),5);
  pass('Invalid pagination recovery stays within the category');
  await page.addScriptTag({path:process.env.UOG_QA_AXE_PATH});
  const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('[aria-busy]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact})));
  fs.writeFileSync(output+'/accessibility.json',JSON.stringify(violations,null,2));
  assert.equal(violations.length,0);
  pass('Archive automated accessibility scan');
 } catch(error) {
  results.push({name:'Browser acceptance',status:'FAIL',error:error.message.slice(0,400)});
  console.error(error.message.slice(0,400));process.exitCode=1;
 } finally {
  fs.writeFileSync(output+'/browser-results.json',JSON.stringify({run:seed.run,browser:browser.version(),results},null,2));
  await browser.close();
 }
})();
