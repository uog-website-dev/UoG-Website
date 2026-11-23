const {chromium}=require('./perf/node_modules/playwright-core');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const out='docs/qa/five-submenu-navigation-2026-11-22';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP *.uog.local 127.0.0.1']});const results=[];
 const academics={label:'Academics',href:'/academics',children:[{label:'Colleges',href:'/colleges',children:[{label:'Informatics',href:'/informatics',children:[{label:'Programs',href:'/programs',children:[{label:'Computer Science',href:'/computer-science',children:[{label:'Undergraduate',href:'/undergraduate'}]}]}]}]},{label:'Institutes and schools',href:'/institutes',children:[{label:'Institute of Technology',href:'/technology'},{label:'School of Law',href:'/law'}]}]};
 try{for(const host of ['www.uog.local','coi.uog.local'])for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**/api/v1/site-context/menus/',async route=>{const response=await route.fetch({url:'http://127.0.0.1/api/v1/site-context/menus/',headers:{Host:host}});const body=await response.json();console.log('Scoped fixture',host,width,body.site);body.locations.header=[{label:'Home',href:'/'},academics,{label:'Research',href:'/research',children:[{label:'Projects',href:'/projects'}]}];await route.fulfill({response,json:body});});
  console.log('Checking',host,width);for(let attempt=0;attempt<3;attempt++){await page.goto(`http://${host}`,{waitUntil:'networkidle'});try{await page.locator('header').waitFor({timeout:30000});break;}catch(e){if(attempt===2)throw e;}}
  if(width===1440){
   const root=page.getByRole('navigation',{name:'Site header desktop'});const trigger=root.getByRole('button',{name:'Academics',exact:true});await trigger.waitFor();await trigger.focus();await page.keyboard.press('ArrowDown');
   for(const label of ['Informatics','Programs','Computer Science']){const button=root.getByRole('button',{name:`Show ${label} submenu`});await button.focus();await page.keyboard.press('Enter');}
   const leaf=root.getByRole('link',{name:'Undergraduate'});await leaf.focus();if(await leaf.getAttribute('href')!='/undergraduate')throw Error('Deep destination lost');
   await page.screenshot({path:path.join(out,`${host}-${width}.png`)});
   const bounds=await root.locator('[data-nav-panel]').boundingBox();if(bounds.x<0||bounds.x+bounds.width>width+1)throw Error('Panel overflow');
   await page.keyboard.press('Escape');if(!await root.getByRole('button',{name:'Show Computer Science submenu'}).evaluate(el=>document.activeElement===el))throw Error('Branch focus not restored');
   await root.getByRole('button',{name:'Research',exact:true}).hover();if(await trigger.getAttribute('aria-expanded')!=='false')throw Error('Previous menu stayed open');
  }else{
   await page.getByRole('button',{name:'Open site header',exact:true}).click();const drawer=page.locator('.MuiDrawer-paper');
   for(const label of ['Academics','Colleges','Informatics','Programs','Computer Science'])await drawer.getByRole('button',{name:label,exact:true}).click();
   await drawer.getByRole('link',{name:'Undergraduate'}).focus();await page.screenshot({path:path.join(out,`${host}-${width}.png`)});
   const overflow=await drawer.evaluate(el=>el.scrollWidth>el.clientWidth);if(overflow)throw Error('Drawer overflow');
  }
  await page.addScriptTag({path:'.git/task-data/release-tools/node_modules/axe-core/axe.min.js'});
  const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);results.push({host,width,overflow,violations,fixture:true,fiveSubmenus:true});if(overflow||violations.length)throw Error(JSON.stringify(results.at(-1)));await page.close();
 }}finally{await browser.close();fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));}
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
