/* Real sign-in and workspace recovery. Private input is never written or logged. */
const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async () => {
 const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
 const origin = process.env.PERF_ORIGIN || 'http://localhost:8088';
 const browser = await chromium.launch({executablePath: process.env.PERF_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
 const result = {checks: [], bootstrap_requests: 0, discovery_requests: 0};
 try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('request', request => {
   const url = new URL(request.url());
   if (url.pathname === '/admin/api/workspace/') result.bootstrap_requests++;
   if (url.pathname === '/admin/api/workspace/sites/') result.discovery_requests++;
  });
  await page.goto(origin + '/admin');
  await page.getByRole('button', {name: 'Sign in with Keycloak', exact: true}).click();
  await page.locator('#username').fill(seed.actor.username);
  await page.locator('#password').fill(seed.actor.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === origin && /^\/admin\/?$/.test(url.pathname));
  const workspace = () => page.getByRole('button', {name: 'Workspace', exact: true}).first();
  await workspace().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Workspace"]')].some(element => !element.disabled));
  assert.equal(result.bootstrap_requests, 1); assert.equal(result.discovery_requests, 0);
  result.checks.push('one shared initial bootstrap; no eager Site discovery');
  const choose = async id => {await workspace().click(); await page.locator(`[data-workspace-site="${id}"]`).click();};
  const ready = async id => {
   await page.waitForURL(url => url.pathname.replace(/\/$/, '') === `/admin/sites/${id}/admin`);
   await page.locator(`[data-perf-site-id="${id}"]`).waitFor();
  };
  const [a, b] = seed.sites;
  await choose(a.id); await ready(a.id);
  assert.equal(result.bootstrap_requests, 2);
  result.checks.push('Site selection performs one new bootstrap');
  await page.reload(); await ready(a.id);
  assert.equal(result.bootstrap_requests, 3);
  result.checks.push('direct-link refresh restores the correct Site');
  const denied = await page.evaluate(async () => {
   const r = await fetch('/admin/api/workspace/?site=99999999', {cache: 'no-store'});
   return {status: r.status, body: await r.json()};
  });
  assert.equal(denied.status, 404); assert(!denied.body.site);
  result.checks.push('unknown Site context is denied without metadata');
  const failed = `**/admin/api/workspace/?site=${b.id}`;
  await page.route(failed, route => route.fulfill({status: 502, contentType: 'application/json', body: '{"error":"workspace_unavailable"}'}));
  await choose(b.id);
  await page.getByText('This Site workspace is unavailable or you no longer have access.', {exact: true}).waitFor();
  assert.equal(await page.locator(`[data-perf-site-id="${a.id}"]`).count(), 0);
  result.checks.push('failed Site change hides prior Site context');
  await page.unroute(failed);
  await page.getByRole('button', {name: 'Retry', exact: true}).click(); await ready(b.id);
  result.checks.push('explicit retry restores the requested Site');
  result.status = 'PASS'; result.browser = browser.version();
 } catch {
  result.status = 'FAIL'; result.failure = 'Workspace browser assertion failed; inspect locally without saving private authentication traces.';
  process.exitCode = 1;
 } finally {await browser.close();}
 const output = process.env.PERF_CHECK_OUTPUT;
 if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
})().catch(() => {console.error('Workspace check failed before results could be recorded.'); process.exitCode = 1;});
