/* Responsive public Page E2E for the approved Document List/Grid widget. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async()=>{
  const seed=JSON.parse(fs.readFileSync(0,'utf8'));
  const output=path.resolve('docs/qa/P4-DOC-007/e2e');
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
  const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();
  page.setDefaultTimeout(30000);
  const results=[];let responseMode='documents';let widgetRequests=[];
  page.on('request',request=>{if(request.url().includes('/api/v1/site-context/'))console.log('REQUEST '+request.url());});
  page.on('response',response=>{if(response.url().includes('/api/v1/site-context/'))console.log('RESPONSE '+response.status()+' '+response.url());});
  const pass=name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
  const layout={schema_version:1,rows:[{id:'documents-row',type:'section',ratios:[100],columns:[{id:'documents-column',type:'column',children:[{id:'documents-widget',type:'document_list',props:{categories:['10000000-0000-4000-8000-000000000001'],limit:3,display:'grid',sort:'title',title:'Official documents'}}]}]}]};
  const document={id:'20000000-0000-4000-8000-000000000001',site:seed.site,title:'Research policy',description:'Approved policy for this Site.',file_type:'application/pdf',file_size:1234,download_url:'/api/v1/site-context/documents/20000000-0000-4000-8000-000000000001/file/',require_login_to_download:true};
  try{
    await page.route('**/api/v1/site-context/pages/docs-widget-e2e/',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'30000000-0000-4000-8000-000000000001',site:seed.site,title:'Documents E2E',path:'/docs-widget-e2e',status:'PUBLISHED',blocks:[],metadata:{visual_layout:layout}})}));
    await page.route('**/api/v1/site-context/widgets/**',async route=>{
      const url=new URL(route.request().url());widgetRequests.push(url.searchParams.toString());
      if(responseMode==='failure'){await route.fulfill({status:503,contentType:'application/json',body:'{}'});return;}
      const results=responseMode==='empty'?[]:[document];
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({site:seed.site,source:'documents',results})});
    });
    const root=`http://${seed.host}/docs-widget-e2e`;
    await page.goto(root,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('heading',{name:'Official documents',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Research policy',exact:true}).waitFor();
    const card=page.locator('[data-widget-type="document_list"] ul > li');
    assert.equal(await card.count(),1);
    const download=page.getByRole('link',{name:/Sign in to download/});
    assert.equal(await download.getAttribute('href'),document.download_url);
    assert(widgetRequests[0]?.includes('limit=3')&&widgetRequests[0].includes('document_sort=title')&&widgetRequests[0].includes('document_categories=10000000-0000-4000-8000-000000000001'));
    pass('Published widget requests configured Site categories, limit, and sort; restricted download link is retained');

    for(const [width,columns] of [[1440,3],[768,2],[390,1]]){
      await page.setViewportSize({width,height:900});
      const actual=await page.locator('[data-widget-type="document_list"] ul').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(actual,columns,`expected ${columns} columns at ${width}px, got ${actual}`);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(output,`documents-${width}.png`),fullPage:true});
    }
    pass('Document Grid is responsive at desktop, tablet, and phone widths without horizontal overflow');

    responseMode='empty';await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('No published documents are available in this section.',{exact:true}).waitFor();
    pass('Empty widget state is announced when no eligible documents are returned');

    responseMode='failure';await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('alert').filter({hasText:'Documents could not be loaded. Try again.'}).waitFor();
    assert.equal(await card.count(),0);
    responseMode='documents';
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.getByRole('heading',{name:'Research policy',exact:true}).waitFor();
    pass('Widget transport failure is contained and Retry recovers without breaking the Page');
  }catch(error){
    results.push({name:'Document widget browser E2E',status:'FAIL',error:error.message.slice(0,600)});
    console.error(error.message.slice(0,600));
    console.error((await page.locator('body').innerText().catch(()=>'' )).slice(0,700));
    process.exitCode=1;
  }finally{
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({site:seed.site,host:seed.host,browser:browser.version(),results},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
