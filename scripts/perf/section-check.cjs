/* PERF-005 real-service list state, cache reuse and shell assertions. Private stdin only. */
const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async () => {
 const seed = JSON.parse(fs.readFileSync(0, 'utf8')), origin = process.env.PERF_ORIGIN || 'http://localhost:8088', site = seed.sites[0].id;
 const browser = await chromium.launch({executablePath: process.env.PERF_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
 const result = {status: 'RUNNING', checks: [], sections: [], browser: browser.version()}; let phase = 'login';
 try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage(); page.setDefaultTimeout(30000);
  let reads = 0, bootstrap = 0;
  page.on('request', request => {if ((request.method() === 'POST' && request.headers()['next-action']) || (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/api/reads'))) reads++; if (/\/api\/workspace\/\?site=/.test(request.url())) bootstrap++;});
  await page.goto(origin + '/admin'); await page.getByRole('button', {name: 'Sign in with Keycloak', exact: true}).click();
  await page.locator('#username').fill(seed.actor.username); await page.locator('#password').fill(seed.actor.password); await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === origin && /^\/admin\/?$/.test(url.pathname));
  const choose = async id => {await page.getByRole('button', {name: 'Workspace', exact: true}).first().click(); await page.locator(`[data-workspace-site="${id}"]`).click(); await page.locator(`[data-perf-site-id="${id}"]`).waitFor();};
  await choose(site); await page.evaluate(() => {window.__sectionShell = document.querySelector('#main-content');});
  const navigate = async name => {
   await page.getByRole('navigation', {name: 'Site sections', exact: true}).locator(`a[href="/admin/sites/${site}/admin${name === 'dashboard' ? '' : '/' + name}"]`).click();
   await page.waitForURL(url => url.pathname.replace(/\/$/,'') === `/admin/sites/${site}/admin${name === 'dashboard' ? '' : '/' + name}`);
   await page.waitForFunction(name => {const node = document.querySelector(`[data-perf-section="${name}"]`); return !!node && node.getAttribute('data-perf-pending') !== 'true' && !node.querySelector('[data-perf-pending="true"],.MuiSkeleton-root');}, name);
   if (name === 'dashboard') await page.waitForFunction(() => !document.querySelector('[data-dashboard-summary-refreshing="true"], [data-dashboard-secondary-pending="true"]'));
  };
  for (const name of ['pages','posts','menus','media']) {
   phase = `${name} filters`; await navigate(name);
   const label = {pages:'Search Pages',posts:'Search Posts',menus:'Search menu directory',media:'Search media'}[name];
   const search = {pages:'information',posts:'University news',menus:'Institutional navigation 1',media:'campus-'}[name];
   await page.getByRole('textbox', {name: label, exact: true}).fill(search);
   if (name === 'pages' || name === 'posts') {
    await page.getByRole('button', {name: 'Apply', exact: true}).click();
    await page.waitForFunction(name => document.querySelector(`[data-perf-section="${name}"]`)?.getAttribute('data-perf-pending') === 'false', name);
    await page.getByRole('table', {name: `${name === 'pages' ? 'Pages' : 'Posts'} for this Site`}).getByText(name === 'pages' ? 'Title' : 'Post', {exact: true}).click();
    await page.waitForFunction(name => document.querySelector(`[data-perf-section="${name}"]`)?.getAttribute('data-perf-pending') === 'false', name);
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
   } else if (name === 'media') {
    await page.getByRole('button', {name: 'Search media', exact: true}).click();
    await page.getByRole('button', {name: 'List view'}).click();
    await page.getByRole('navigation', {name: 'Media pagination'}).getByRole('button', {name: 'Next', exact: true}).click();
   }
   await page.waitForFunction(name => document.querySelector(`[data-perf-section="${name}"]`)?.getAttribute('data-perf-pending') === 'false', name);
   const snapshot = await page.locator(`[data-perf-section="${name}"]`).innerText();
   await navigate('dashboard');
   const before = reads, contexts = bootstrap;
   await page.evaluate(name => {window.__sectionFlashes = 0; window.__sectionObserver = new MutationObserver(() => {const node = document.querySelector(`[data-perf-section="${name}"]`); if (node && (node.getAttribute('data-perf-pending') === 'true' || node.querySelector('.MuiSkeleton-root'))) window.__sectionFlashes++;}); window.__sectionObserver.observe(document.body, {childList: true, subtree: true, attributes: true});}, name);
   phase = `${name} return`; await navigate(name); await page.waitForTimeout(100);
   const flashes = await page.evaluate(() => {window.__sectionObserver.disconnect(); return window.__sectionFlashes;});
   assert.equal(await page.getByRole('textbox', {name: label, exact: true}).inputValue(), search);
   if (name === 'media') assert.equal(await page.getByRole('button', {name: 'List view'}).getAttribute('aria-pressed'), 'true');
   assert.equal(await page.locator(`[data-perf-section="${name}"]`).innerText(), snapshot, 'List state/order changed on return');
   assert.equal(reads - before, 0, 'Unchanged list repeated a read'); assert.equal(bootstrap - contexts, 0, 'Same-Site section reloaded context'); assert.equal(flashes, 0);
   assert(await page.evaluate(() => window.__sectionShell === document.querySelector('#main-content')), 'Shell remounted');
   result.sections.push({section: name, restored: true, list_reads: reads - before, workspace_reads: bootstrap - contexts, loading_flashes: flashes});
  }
  result.checks.push('All four section searches and list order restored; Pages/Posts sorting and pagination and Media layout/pagination retained; shell stable');
  phase = 'foreign Site state isolation';
  await choose(seed.sites[1].id); await page.getByRole('textbox', {name: 'Search media', exact: true}).waitFor();
  assert.equal(await page.getByRole('textbox', {name: 'Search media', exact: true}).inputValue(), '');
  result.checks.push('Site B Media opens with its own default filters, without an unsaved-draft prompt');
  result.status = 'PASS';
 } catch (error) {result.status = 'FAIL'; result.failed_phase = phase; result.error = {type:error.name, message:String(error.message).split('Call log:')[0].replaceAll(seed.actor.password,'[REDACTED]').replaceAll(seed.actor.token,'[REDACTED]').replace(/https?:\/\/[^\s]+/g,'[URL omitted]').slice(0,400)}; process.exitCode = 1;}
 finally {await browser.close();}
 if (process.env.PERF_SECTION_CHECK_OUTPUT) fs.writeFileSync(process.env.PERF_SECTION_CHECK_OUTPUT, JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
})().catch(() => {console.error('Section check failed before recording results.'); process.exitCode = 1;});
