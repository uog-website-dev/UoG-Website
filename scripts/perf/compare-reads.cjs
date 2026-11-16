/* Compare protocol, request count and latency; never read/save response bodies. */
const fs=require('node:fs'),{percentile}=require('./metrics.cjs');
const [beforeFile,afterFile]=process.argv.slice(2);
const runs=[beforeFile,afterFile].map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
for(const run of runs)if(run.metadata.run_status!=='complete'||run.metadata.verified_server_mode!=='production'||run.failures.length||!run.trace_summary.all_api_samples_correlated)throw new Error('Need completed, correlated production runs');
const metric=(rows,select)=>percentile(rows.map(select),.5),round=n=>Math.round(n),readPost=r=>r.method==='POST'&&!!r.action_id,readGet=r=>r.method==='GET'&&r.path.startsWith('/admin/api/reads');
console.log('# P0-PERF-008 read transport comparison\n\n**Budgets/methodology remain PROPOSED pending product/QA approval.**\n');
console.log('| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p50 total requests before / after | p50 read action POSTs before / after | p50 JSON read GETs before / after | p50 transferred bytes before / after |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const scenario of ['cold_site_switch','warm_site_switch','same_site_menu_navigation','cached_section_return','cached_section_transition']){
 const groups=runs.map(run=>run.samples.filter(r=>r.scenario===scenario));
 const [a,b]=runs.map(run=>run.summary[scenario]);
 const values=select=>groups.map(rows=>round(metric(rows,select))).join(' / ');
 console.log(`| ${scenario} | ${round(a.p50_ms)} / ${round(a.p95_ms)} | ${round(b.p50_ms)} / ${round(b.p95_ms)} | ${values(r=>r.requests)} | ${values(r=>r.waterfall.filter(readPost).length)} | ${values(r=>r.waterfall.filter(readGet).length)} | ${values(r=>r.transferred_bytes)} |`);
}
console.log('\nThe scenario named same_site_menu_navigation opens the Pages section through the workspace navigation; it does not mean the Menus editor. Counts include route code/favicon traffic inside the same measurement boundary. Physical browser→Next→Django trust boundaries remain. GETs remove the read-action Flight framing and action queue; they do not bypass Next authentication. Cached returns retain the shared query cache. Raw samples preserve bytes, requests, waterfalls and SQL counts.\n');
console.log('Latency and transferred bytes are end-to-end protocol/transport observations, not pure CPU serialization timings. Browser-reads evidence separately measures response JSON parsing and the instrumented BFF/upstream/JSON-encoding spans. Before/after runs are sequential local smoke samples; retained caches and host activity can affect results. A Menu directory now uses two parallel GETs for menus/inheritance rather than one action with two sequential upstream reads: that trades one additional browser request for parallel progress. Specialized editor actions remain documented in the inventory.');
