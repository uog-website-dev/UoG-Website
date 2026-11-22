const {chromium}=require('./perf/node_modules/playwright-core');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const out='docs/qa/footer-menu-columns-2026-11-22';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});
 const results=[];
 try{for(const host of ['www.uog.local','coi.uog.local'])for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/api/v1/site-context/menus/',async route=>{
   const response=await route.fetch({url:'http://127.0.0.1/api/v1/site-context/menus/',headers:{Host:host}});if(!response.ok())throw Error('Menu endpoint unavailable');
   const body=await response.json();body.locations.footer=[
    {label:'University',href:'',column:true,children:[{label:'About us',href:'/about'},{label:'Contact',href:'/contact'}]},
    {label:'Resources',href:'',column:true,children:[{label:'News',href:'/posts'}]},
    {label:'Community',href:'',column:true,children:[]}];
   await route.fulfill({response,json:body});
  });
  const loaded=await page.goto(`http://${host}`,{waitUntil:'networkidle'});if(!loaded.ok())throw Error(`Public host unavailable: ${host}`);
  const nav=page.getByRole('navigation',{name:'Footer navigation'});await nav.getByRole('heading',{name:'Community',exact:true}).waitFor().catch(async e=>{console.log((await page.locator("body").innerText()).slice(0,1000));throw e;});
  await nav.scrollIntoViewIfNeeded();
  const sizes=await nav.locator(':scope > section').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,top:n.getBoundingClientRect().top})));
  if(sizes.length!==3||Math.max(...sizes.map(n=>n.width))-Math.min(...sizes.map(n=>n.width))>1)throw Error('Unequal column widths');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Horizontal overflow');
  if(width===1440&&new Set(sizes.map(n=>Math.round(n.top))).size!==1)throw Error('Desktop columns not in one row');
  if(width===390&&new Set(sizes.map(n=>Math.round(n.top))).size!==3)throw Error('Mobile columns not stacked');
  await page.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
  const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('footer'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id));
  if(violations.length)throw Error(JSON.stringify(violations));
  await page.locator('footer').screenshot({path:path.join(out,`${host}-${width}.png`)});
  results.push({host,width,sizes,overflow,violations,fixture:true});await page.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
