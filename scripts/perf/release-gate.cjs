const fs=require('node:fs'),crypto=require('node:crypto');
const {percentile}=require('./metrics.cjs');
function evaluate(data,policy,{release=false,evidence=null,evidenceHash=null,resultsHash=null}={}){
 const errors=[],metrics={};const requireThat=(ok,message)=>{if(!ok)errors.push(message);};
 requireThat(data.metadata?.run_status==='complete','incomplete benchmark');
 requireThat(data.metadata?.mode==='production'&&data.metadata?.verified_server_mode==='production'&&data.metadata?.release_baseline===true&&!data.metadata?.react_profiling,'unverified production baseline');
 requireThat(Array.isArray(data.failures)&&data.failures.length===0,'benchmark failures');
 requireThat(data.trace_summary?.all_api_samples_correlated===true,'uncorrelated API samples');
 requireThat(Array.isArray(data.metadata?.sites)&&data.metadata.sites.length>=policy.minimum_sites,'insufficient Sites');
 requireThat(Array.isArray(data.samples)&&data.samples.length>0,'missing raw samples');
 for(const [name,limit]of Object.entries(policy.scenarios)){
  const rows=(data.samples??[]).filter(s=>name==='dashboard_usable'?s.dashboard_usable_ms!=null:s.scenario===name),values=rows.map(s=>name==='dashboard_usable'?s.dashboard_usable_ms:s.duration_ms);
  requireThat(rows.length>=policy.minimum_samples,`${name}: insufficient samples`);
  requireThat(values.every(v=>Number.isFinite(v)&&v>=0),`${name}: invalid duration`);
  const p50=percentile(values,.5),p95=percentile(values,.95);metrics[name]={n:rows.length,p50_ms:p50,p95_ms:p95};
  requireThat(p50!==null&&p50<=limit.p50_ms,`${name}: p50 budget exceeded`);
  requireThat(p95!==null&&p95<=limit.p95_ms,`${name}: p95 budget exceeded`);
  if(limit.max_duplicate_reads!==undefined)for(const row of rows){
   requireThat(Array.isArray(row.duplicate_endpoints),`${name}: missing duplicate evidence`);
   // Only read BFF/Workspace GETs count. RSC/code retries are separate diagnostic traffic.
   const duplicate=(row.duplicate_endpoints??[]).filter(d=>/^GET .*\/api\/(?:reads|workspace)\/?(?:[?]|$)/.test(d.endpoint)).reduce((n,d)=>n+Math.max(0,d.count-1),0);
   requireThat(duplicate<=limit.max_duplicate_reads,`${name}: duplicate scoped reads`);
  }
 }
 if(release){
  requireThat(evidence?.commit===data.metadata?.source?.commit,'release evidence commit mismatch');
  requireThat(resultsHash&&evidence?.artifacts_sha256?.['final/production/results.json']===resultsHash,'benchmark hash differs from reviewed manifest');
  for(const name of ['browser','backend','frontend','build','api_load','service_health','openapi'])requireThat(evidence?.checks?.[name]==='PASS',`${name}: release evidence missing or failed`);
  requireThat(evidenceHash&&policy.signoffs?.qa?.evidence_sha256===evidenceHash&&policy.signoffs?.security?.evidence_sha256===evidenceHash,'sign-offs must bind the evidence manifest hash');
  requireThat(policy.status==='APPROVED'&&!!policy.approved_by&&!!policy.approved_at,'budget/methodology approval missing');
  requireThat(policy.signoffs?.qa?.approved===true&&!!policy.signoffs.qa.reviewer&&!!policy.signoffs.qa.at,'QA sign-off missing');
  requireThat(policy.signoffs?.security?.approved===true&&!!policy.signoffs.security.reviewer&&!!policy.signoffs.security.at,'Security sign-off missing');
 }
 return {status:errors.length?'FAIL':release?'PASS':'CANDIDATE_PASS',release_authorized:release&&!errors.length,policy_status:policy.status,errors:[...new Set(errors)],metrics};
}
if(require.main===module){
 const [file,policyFile,...flags]=process.argv.slice(2);if(!file||!policyFile)throw Error('Usage: release-gate.cjs results.json policy.json [--release]');
 const raw=fs.readFileSync(file),policyRaw=fs.readFileSync(policyFile);const index=flags.indexOf('--evidence');const evidenceRaw=index>=0?fs.readFileSync(flags[index+1]):null;const result=evaluate(JSON.parse(raw),JSON.parse(policyRaw),{release:flags.includes('--release'),resultsHash:crypto.createHash('sha256').update(raw).digest('hex'),evidence:evidenceRaw?JSON.parse(evidenceRaw):null,evidenceHash:evidenceRaw?crypto.createHash('sha256').update(evidenceRaw).digest('hex'):null});
 result.inputs={results_sha256:crypto.createHash('sha256').update(raw).digest('hex'),policy_sha256:crypto.createHash('sha256').update(policyRaw).digest('hex')};
 console.log(JSON.stringify(result,null,2));if(result.status==='FAIL')process.exitCode=1;
}
module.exports={evaluate};
