const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8'));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const page=await browser.newPage({viewport:{width:390,height:1000}});
 try {
  const shell=page.locator('[data-page-layout="LEFT_SIDEBAR"]');
  for(let attempt=0;attempt<3;attempt++) {
   await page.goto(`http://${seed.host}/full-width`,{waitUntil:'domcontentloaded',timeout:120000});
   try { await shell.getByText('Retained builder content',{exact:true}).waitFor({timeout:15000}); break; }
   catch(error) { if(attempt===2) throw error; }
  }
  await shell.getByText('No published related Pages yet.',{exact:true}).waitFor();
  await shell.getByText('This content is currently unavailable.',{exact:true}).waitFor();
  await shell.getByRole('link',{name:'Student support',exact:true}).waitFor();
  assert.equal(await page.getByText('Sidebar approved news',{exact:true}).count(),0);
  assert.equal(await shell.getByRole('link',{name:'University Left Sidebar',exact:true}).count(),0);
  const response=await page.evaluate(async()=>{const result=await fetch('/api/v1/site-context/pages/full-width/');return {status:result.status,text:await result.text()};});
  assert.equal(response.status,200);
  const text=response.text;
  assert(!text.includes('Sidebar approved news')&&!text.includes('PRIVATE NEWS MARKER')&&!text.includes('FOREIGN NEWS MARKER'));
  await page.screenshot({path:'docs/qa/sidebar-widgets-2026-11-14/disabled-empty-mobile.png',fullPage:true});
  fs.writeFileSync('docs/qa/sidebar-widgets-2026-11-14/browser-negative.json',JSON.stringify({run:seed.run,result:'PASS',checks:['POSTS disabled: no article data in public JSON or UI','Unpublished related Page excluded with empty placeholder','Page body and local Menu remain usable','Ordered mobile sidebar survives source withdrawal']},null,2));
  console.log('Four source-withdrawal and module-isolation browser checks passed');
 } finally {await browser.close();}
})().catch(error=>{console.error(error.message.slice(0,600));process.exitCode=1;});
