/* Browser regression for the production shared renderer using controlled fixtures. */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
const output=path.resolve(process.env.UOG_QA_OUTPUT);
const root=path.resolve(process.env.UOG_QA_FIXTURE_ROOT);
fs.mkdirSync(output,{recursive:true});
const rows=[];
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/v1/site-context/media/') || pathname.startsWith('/admin/sites/11/media/')){
    res.setHeader('Content-Type','image/jpeg');res.end(fs.readFileSync(process.env.UOG_QA_IMAGE));return;
  }
  const relative=pathname.startsWith('/assets/')?pathname.slice(1):'index.html';
  const file=path.join(root,relative);
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',relative.endsWith('.js')?'application/javascript':'text/html');
  res.end(fs.readFileSync(file));
});
async function main(){
  await new Promise(resolve=>server.listen(4176,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
  try{
    for(const surface of ['public','preview']){
      for(const width of [320,390,768,1280,1440]){
        const context=await browser.newContext({viewport:{width,height:1000}});
        const page=await context.newPage();
        await page.route(/\/(?:api\/v1\/site-context\/media|admin\/sites\/11\/media)\//,route=>route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(process.env.UOG_QA_IMAGE)}));
        await page.goto(`http://127.0.0.1:4176/?surface=${surface}`);
        await page.getByRole('heading',{name:'Accessible published layout'}).waitFor();
        const metrics=await page.evaluate(()=>({
          scroll:document.documentElement.scrollWidth,width:innerWidth,
          columns:getComputedStyle(document.querySelector('[data-node-id="three-columns"]')).gridTemplateColumns.split(' ').length,
          headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e=>e.tagName),
          alternatives:[...document.querySelectorAll('img')].every(e=>e.hasAttribute('alt')),
        }));
        assert.ok(metrics.scroll<=width+1,JSON.stringify(metrics));
        assert.equal(metrics.columns,width>=1280?3:1);
        assert.deepEqual(metrics.headings,['H1','H2','H2','H2']);
        assert.ok(metrics.alternatives);
        await page.keyboard.press('Tab');
        await assertFocused(page,'Next slide');
        const indicator=await page.locator(':focus').evaluate(e=>getComputedStyle(e).outlineWidth);
        assert.notEqual(indicator,'0px');
        await page.keyboard.press('Enter');
        await page.getByText('2 of 2',{exact:true}).waitFor();
        await page.keyboard.press('Shift+Tab');
        await assertFocused(page,'Previous slide');
        await page.keyboard.press('Enter');
        await page.getByText('1 of 2',{exact:true}).waitFor();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await assertFocused(page,'Overview');
        await page.keyboard.press('ArrowRight');
        await assertFocused(page,'Details');
        assert.equal(await page.getByRole('tab',{name:'Details'}).getAttribute('aria-selected'),'true');
        await page.keyboard.press('Home');
        await assertFocused(page,'Overview');
        await page.keyboard.press('End');
        await assertFocused(page,'Details');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(':focus').getAttribute('role'),'tabpanel');
        await page.keyboard.press('Tab');
        await assertFocused(page,'First question');
        await page.keyboard.press('Tab');
        await assertFocused(page,'Second question');
        await page.keyboard.press('Enter');
        assert.ok(await page.locator('details').nth(1).getAttribute('open')!==null);
        await page.keyboard.press('Tab');
        await assertFocused(page,'Read more');
        assert.equal(await page.locator(':focus').getAttribute('href'),'/about');
        assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);
        assert.equal(await page.locator('[onerror],a[href^="javascript:"],script:not([src])').count(),0);
        await page.addScriptTag({path:process.env.UOG_QA_AXE});
        const scan=await page.evaluate(async()=>{
          const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
          return {violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),incomplete:result.incomplete.map(v=>v.id),passes:result.passes.length};
        });
        assert.deepEqual(scan.violations,[]);
        await page.screenshot({path:path.join(output,`${surface}-${width}.png`),fullPage:true});
        rows.push({surface,width,status:'PASS',metrics,focusIndicator:indicator,keyboard:'slider, tabs, panels, accordion and link passed',axe:scan});
        await context.close();
      }
      for(const scenario of ['script-url','style-token','unknown-version','foreign-media']){
        const page=await browser.newPage();
        await page.goto(`http://127.0.0.1:4176/?surface=${surface}&scenario=${scenario}`);
        await page.getByRole('status').filter({hasText:'unavailable'}).waitFor();
        assert.equal(await page.locator('a,img,[data-layout-version]').count(),0);
        assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);
        rows.push({surface,scenario,status:'PASS',outcome:'Invalid layout fails closed without links, images or active content'});
        await page.close();
      }
    }
  }finally{await browser.close();server.close();}
}
async function assertFocused(page,label){
  await page.waitForFunction(value=>document.activeElement?.textContent?.trim()===value,label);
}
if(process.argv.includes('--serve')) server.listen(4176,'127.0.0.1',()=>console.log('Accessibility fixture at http://127.0.0.1:4176'));
else main().then(()=>{
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({scope:'Controlled fixtures using the real shared production renderer and theme, with media transport fixtures',target:'WCAG 2.2 AA review assumption',rows},null,2));
  console.log(JSON.stringify({status:'PASS',checks:rows.length}));
}).catch(error=>{
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({status:'FAIL',rows,error:error.message},null,2));
  console.error(error.message);server.close();process.exitCode=1;
});
