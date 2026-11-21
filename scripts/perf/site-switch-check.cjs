/* PERF-004 real-service switching regression. Credentials arrive on private stdin. */
const fs = require('node:fs'), assert = require('node:assert/strict'), {spawnSync} = require('node:child_process');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async () => {
 const seed = JSON.parse(fs.readFileSync(0, 'utf8')), origin = process.env.PERF_ORIGIN || 'http://localhost:8088';
 assert(seed.sites.length >= 21, 'Seed at least 21 Sites for discovery checks');
 const browser = await chromium.launch({executablePath: process.env.PERF_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
 const result = {status: 'RUNNING', checks: [], sites: seed.sites.length, browser: browser.version()};
 const [a, b] = seed.sites.map(site => site.id); let phase = 'login', revoked = false;
 const membership = revoke => {
  const code = `import json; from pathlib import Path; from django.conf import settings; from django.utils import timezone; from apps.authorization.models import UserRoleAssignment; assert settings.DEBUG; data=json.loads(Path('/tmp/perf001-session.json').read_text()); rows=UserRoleAssignment.objects.filter(user_id=data['actor_id'],site_id=${a},scope='SITE'); assert rows.count()==1; rows.update(revoked_at=${revoke ? 'timezone.now()' : 'None'}); print('fixture membership updated')`;
  const child = spawnSync('docker', ['compose','exec','-T','backend','python','manage.py','shell','-c',code], {encoding: 'utf8'});
  assert.equal(child.status, 0, 'Managed fixture membership update failed');
 };
 try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage(); page.setDefaultTimeout(30000);
  let reads = 0; page.on('request', request => {if ((request.method() === 'POST' && request.headers()['next-action']) || (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/api/reads'))) reads++;});
  await page.goto(origin + '/admin'); await page.getByRole('button', {name: 'Sign in with Keycloak', exact: true}).click();
  await page.locator('#username').fill(seed.actor.username); await page.locator('#password').fill(seed.actor.password); await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === origin && /^\/admin\/?$/.test(url.pathname));
  const choose = async id => {await page.getByRole('button', {name: 'Workspace', exact: true}).first().click(); await page.locator(`[data-workspace-site="${id}"]`).click();};
  const ready = async id => {
   await page.waitForURL(url => url.pathname.replace(/\/$/,'') === `/admin/sites/${id}/admin/pages`);
   await page.locator(`[data-perf-site-id="${id}"]`).getByRole('table', {name: 'Pages for this Site'}).waitFor();
   await page.waitForFunction(id => document.querySelector(`[data-perf-site-id="${id}"] [data-perf-section="pages"]`)?.getAttribute('data-perf-pending') === 'false', id);
  };
  phase = '21-Site keyboard discovery';
  await page.getByRole('button', {name: 'Workspace', exact: true}).first().click();
  await page.getByText('Page 1 · 21 Sites', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Next Sites', exact: true}).focus(); await page.keyboard.press('Enter');
  await page.getByText('Page 2 · 21 Sites', {exact: true}).waitFor();
  await page.getByRole('textbox', {name: 'Search Sites'}).fill(seed.sites[0].name);
  await page.locator(`[data-workspace-site="${a}"]`).waitFor();
  await page.locator(`[data-workspace-site="${a}"]`).focus(); await page.keyboard.press('Enter');
  await page.locator(`[data-perf-site-id="${a}"]`).waitFor();
  await page.getByRole('navigation', {name: 'Site sections'}).getByRole('link').filter({hasText: 'Pages'}).click(); await ready(a);
  result.checks.push('21 authorized Sites: keyboard pagination, debounced search and keyboard selection');
  await page.evaluate(() => {window.__perfShell = document.querySelector('#main-content');});
  phase = 'section preservation and cached return';
  await choose(b); await ready(b);
  const before = reads; await choose(a); await ready(a);
  result.warm_return_reads = reads - before; assert.equal(result.warm_return_reads, 0, 'Fresh return repeated list reads');
  assert(await page.evaluate(() => window.__perfShell === document.querySelector('#main-content')), 'Shell was remounted');
  assert.equal(await page.locator(`[data-perf-site-id="${b}"]`).count(), 0);
  result.checks.push('Pages section preserved; shell DOM retained; fresh A return has zero list RPCs and no B content');
  phase = 'unsaved draft confirmation';
  const edit = page.getByRole('link', {name: /^Edit /}).first(); await edit.click();
  const title = page.getByRole('textbox', {name: 'Title', exact: true}); await title.waitFor();
  await title.fill('PERF-004 UNSAVED PRIVATE DRAFT');
  let confirmations = 0;
  page.once('dialog', async dialog => {confirmations++; await dialog.dismiss();}); await choose(b);
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  assert.equal(await title.inputValue(), 'PERF-004 UNSAVED PRIVATE DRAFT');
  page.once('dialog', async dialog => {confirmations++; await dialog.accept();}); await choose(b); await ready(b);
  assert.equal(confirmations, 2); assert.equal(await page.getByText('PERF-004 UNSAVED PRIVATE DRAFT', {exact: true}).count(), 0);
  result.checks.push('Cancel preserves unsaved Page text; confirmed switch resets it and strips foreign Page IDs');
  phase = 'rapid A-B-A with delayed B context';
  await choose(a); await ready(a);
  // Force only B's bootstrap stale, using browser focus lease invalidation on B
  // is unnecessary: wait past the documented lease so B must revalidate.
  await page.waitForTimeout(31_000);
  let release, interceptedResolve;
  const intercepted = new Promise(resolve => {interceptedResolve = resolve;});
  const held = new Promise(resolve => {release = resolve;});
  await page.route(`**/admin/api/workspace/?site=${b}`, async route => {interceptedResolve(); await held; try {await route.fulfill({status: 403, contentType: 'application/json', body: '{"detail":"Injected delayed denial"}'});} catch { /* aborted old transport */ }});
  await choose(b); await intercepted;
  await choose(a); await ready(a); release(); await page.waitForTimeout(200);
  assert.equal(await page.locator(`[data-perf-site-id="${b}"]`).count(), 0);
  await page.unroute(`**/admin/api/workspace/?site=${b}`);
  result.checks.push('Rapid A-B-A ignores injected delayed forbidden B response; A remains readable');
  phase = 'live membership revocation'; membership(true); revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('uog:workspace:refresh')));
  await page.getByText(/This Site workspace is unavailable or you no longer have access/).waitFor();
  assert.equal(await page.getByRole('table', {name: 'Pages for this Site'}).count(), 0);
  await choose(b); await ready(b);
  result.checks.push('Real Django membership revocation removes protected A data; switcher still recovers to permitted B');
  membership(false); revoked = false;
  result.status = 'PASS';
 } catch (error) {result.status = 'FAIL'; result.failed_phase = phase; result.error = {type: error.name, message: String(error.message).split('Call log:')[0].replaceAll(seed.actor.password, '[REDACTED]').replaceAll(seed.actor.token, '[REDACTED]').replace(/https?:\/\/[^\s]+/g, '[URL omitted]').slice(0, 400)}; process.exitCode = 1;}
 finally {if (revoked) {membership(false); result.fixture_membership_restored = true;} await browser.close();}
 if (process.env.PERF_SWITCH_CHECK_OUTPUT) fs.writeFileSync(process.env.PERF_SWITCH_CHECK_OUTPUT, JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
})().catch(() => {console.error('Site switching check failed before recording results.'); process.exitCode = 1;});
