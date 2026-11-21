/* Cross-Site object-ID forgery against real APIs; no object bodies saved. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {request}=require(process.env.UOG_QA_PLAYWRIGHT_ROOT||'playwright-core');
(async()=>{
 const seed=JSON.parse(fs.readFileSync(0,'utf8')),origin=process.env.PERF_ORIGIN||'http://localhost:8088',out=process.env.PERF_OUTPUT;assert(out);const [a,b]=seed.sites.map(s=>s.id);
 const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Authorization:'Bearer '+seed.actor.token}});const result={status:'RUNNING',checks:[]};let phase='initialization';
 try{for(const [resource,patch] of [['pages',{title:'PERF010 forbidden edit'}],['posts',{title:'PERF010 forbidden edit'}],['menus',{name:'PERF010 forbidden edit'}],['assets',{alt_text:'PERF010 forbidden edit'}]]){
  phase=resource;const list=await api.get(`/api/v1/sites/${b}/${resource}/?page_size=1`);assert.equal(list.status(),200);const rows=(await list.json()).results;assert(rows.length);const id=rows[0].id;const own=`/api/v1/sites/${b}/${resource}/${id}/`,foreign=`/api/v1/sites/${a}/${resource}/${id}/`;
  const before=await api.get(own);assert.equal(before.status(),200);const data=await before.json();
  for(const method of ['get','patch']){const response=await api[method](foreign,method==='patch'?{data:patch,headers:{'If-Match':before.headers().etag??'"invalid"'}}:{});assert([403,404].includes(response.status()),'Foreign scoped ID was accepted');const body=await response.text();for(const value of [data.title,data.original_filename])if(value)assert(!body.includes(value),'Foreign metadata disclosed');}
  const after=await api.get(own);assert.equal(after.status(),200);assert.deepEqual(await after.json(),data,'Rejected cross-Site write changed source object');result.checks.push({resource,foreign_read:'DENIED',foreign_write:'DENIED',source_unchanged:true});
 }result.status='PASS';}catch{result.status='FAIL';result.failed_phase=phase;process.exitCode=1;}finally{await api.dispose();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'isolation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(()=>{console.error('API isolation check failed before evidence');process.exitCode=1;});
