const fs = require('node:fs'), {percentile} = require('./metrics.cjs');
const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) throw new Error('Provide PERF-001 and PERF-002 production results.json');
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')), after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
for (const run of [before, after]) {
 if (run.metadata.run_status !== 'complete' || run.metadata.verified_server_mode !== 'production' || run.failures.length || !run.trace_summary?.all_api_samples_correlated) throw new Error('Comparison requires complete, correlated production runs');
}
const round = number => Math.round(number);
const lines = ['# PERF-002 versus PERF-001 production', '', '**Budgets and methodology remain PROPOSED; product/QA approval is pending.**', '', '| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |', '| --- | ---: | ---: | ---: |'];
for (const name of ['workspace_api', 'cold_site_switch', 'warm_site_switch', 'dashboard_usable', 'same_site_menu_navigation', 'cached_section_return', 'cached_section_transition']) {
 const a = before.summary[name], b = after.summary[name];
 lines.push(`| ${name} | ${round(a.p50_ms)} / ${round(a.p95_ms)} (n=${a.n}) | ${round(b.p50_ms)} / ${round(b.p95_ms)} (n=${b.n}) | ${(100 * (a.p95_ms - b.p95_ms) / a.p95_ms).toFixed(1)}% |`);
}
lines.push('', '| Scenario | Median Django requests before / after | Median SQL count before / after |', '| --- | ---: | ---: |');
for (const name of ['workspace_api', 'cold_site_switch', 'warm_site_switch', 'same_site_menu_navigation', 'cached_section_return', 'cached_section_transition']) {
 const median = (run, key) => round(percentile(run.samples.filter(sample => sample.scenario === name).map(sample => sample.server[key]), .5));
 lines.push(`| ${name} | ${median(before, 'django_requests')} / ${median(after, 'django_requests')} | ${median(before, 'sql_count')} / ${median(after, 'sql_count')} |`);
}
lines.push('', 'The direct workspace API probe uses the same authenticated Next URL in both runs. Site-switch interaction now includes opening and loading the lazy searchable dialog; PERF-001 used an already populated native selector. Same host/dataset/profile, sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.', '', 'Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. The dedicated browser regression separately asserts one bootstrap per selection and no discovery before opening the switcher.', '');
console.log(lines.join('\n'));
