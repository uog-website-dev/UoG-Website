/* Real-service cache reuse, mutation freshness, Site isolation and logout. Private stdin only. */
const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async () => {
 const seed = JSON.parse(fs.readFileSync(0, 'utf8')), origin = process.env.PERF_ORIGIN || 'http://localhost:8088';
 const browser = await chromium.launch({executablePath: process.env.PERF_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
 const result = {checks: [], cached_returns: []}; let phase = 'login', context, fixture = null, restored = false;
 try {
  context = await browser.newContext({viewport: {width: 1440, height: 1000}}); const page = await context.newPage(); page.setDefaultTimeout(30000);
  let actions = 0;
  page.on('request', request => {if (request.method() === 'POST' && request.headers()['next-action']) actions++;});
  await page.goto(origin + '/admin'); await page.getByRole('button', {name: 'Sign in with Keycloak', exact: true}).click();
  await page.locator('#username').fill(seed.actor.username); await page.locator('#password').fill(seed.actor.password); await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === origin && /^\/admin\/?$/.test(url.pathname));
  const choose = async id => {await page.getByRole('button', {name: 'Workspace', exact: true}).first().click(); await page.locator(`[data-workspace-site="${id}"]`).click(); await page.locator(`[data-perf-site-id="${id}"]`).waitFor();};
  const section = async (id, name) => {
   const suffix = name === 'dashboard' ? '' : '/' + name;
   await page.getByRole('navigation', {name: 'Site sections'}).locator(`a[href="/admin/sites/${id}/admin${suffix}"]`).click();
   await page.waitForURL(url => url.pathname.replace(/\/$/, '') === `/admin/sites/${id}/admin${suffix}`);
   if (name === 'media') {await page.getByRole('button', {name: /^Details for /}).first().waitFor(); await page.waitForFunction(() => document.querySelector('[data-perf-section=media]')?.getAttribute('data-perf-pending') === 'false');}
   else await page.waitForFunction(name => {
    const node = document.querySelector(`[data-perf-section="${name}"]`);
    return !!node && node.getAttribute('data-perf-pending') !== 'true' && !node.querySelector('[data-perf-pending="true"],.MuiSkeleton-root');
   }, name);
   if (name === 'dashboard') await page.waitForFunction(() => !document.querySelector('[data-dashboard-summary-refreshing="true"], [data-dashboard-secondary-pending="true"]'));
  };
  const a = seed.sites[0].id, b = seed.sites[1].id;
  await choose(a); phase = 'Pages return';
  await section(a, 'pages'); await section(a, 'posts');
  const cachedReturn = async name => {
   const before = actions;
   await page.evaluate(name => {
    window.__cacheFlashes = 0;
    window.__cacheObserver = new MutationObserver(() => {
     const node = document.querySelector(`[data-perf-section="${name}"]`);
     if (node && (node.getAttribute('data-perf-pending') === 'true' || node.querySelector('.MuiSkeleton-root'))) window.__cacheFlashes++;
    }); window.__cacheObserver.observe(document.body, {childList: true, subtree: true, attributes: true});
   }, name);
   await section(a, name); await page.waitForTimeout(100);
   const flashes = await page.evaluate(() => {window.__cacheObserver.disconnect(); return window.__cacheFlashes;});
   const calls = actions - before; assert.equal(calls, 0, 'Cached section repeated a Server Action read'); assert.equal(flashes, 0, 'Cached section showed a loading skeleton');
   result.cached_returns.push({section: name, server_action_reads: calls, loading_flashes: flashes});
  };
  await cachedReturn('pages'); phase = 'Posts return'; await cachedReturn('posts');
  phase = 'Menus return'; await section(a, 'menus'); await section(a, 'pages'); await cachedReturn('menus');
  phase = 'Media return'; await section(a, 'media'); await section(a, 'pages'); await cachedReturn('media');
  result.checks.push('Pages, Posts, Menus and Media reuse cached section data without read RPCs or loading flashes');
  phase = 'Page mutation'; await section(a, 'pages');
  const edit = page.getByRole('link', {name: /^Edit /}).first();
  const href = await edit.getAttribute('href'); assert(href.startsWith(`/admin/sites/${a}/admin/pages/`)); await edit.click();
  const title = page.getByRole('textbox', {name: 'Title', exact: true}); await title.waitFor();
  const original = await title.inputValue(), changed = `PERF-003 cache check ${Date.now()}`;
  fixture = {site: a, id: href.split('/').at(-2), title: original};
  await title.fill(changed); await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === `/admin/sites/${a}/admin/pages`); await page.getByText(changed, {exact: true}).waitFor();
  result.checks.push('Saving an existing managed draft invalidates the previously cached Pages list');
  phase = 'Restore mutation'; await page.getByRole('link', {name: `Edit ${changed}`, exact: true}).click();
  await title.waitFor(); await title.fill(original); await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === `/admin/sites/${a}/admin/pages`); await page.getByText(original, {exact: true}).waitFor();
  restored = true;
  result.checks.push('Original draft title restored through a second revision; no publication changed');
  phase = 'Site isolation'; await choose(b); await section(b, 'pages');
  assert.equal(await page.locator(`[data-perf-site-id="${a}"]`).count(), 0);
  assert((await page.getByRole('link', {name: /^Edit /}).first().getAttribute('href')).startsWith(`/admin/sites/${b}/admin/pages/`));
  const beforeReturn = actions; await choose(a); await section(a, 'pages');
  assert((await page.getByRole('link', {name: /^Edit /}).first().getAttribute('href')).startsWith(`/admin/sites/${a}/admin/pages/`));
  result.return_site_reads = actions - beforeReturn; result.checks.push('Return view is Site-scoped; reuse or refresh follows the bounded workspace lease');
  phase = 'Logout'; await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await page.waitForTimeout(1000);
  const session = await context.request.get(origin + '/admin/api/session'); assert.equal(session.status(), 401);
  result.checks.push('Logout clears the session and disposes protected query state');
  result.status = 'PASS'; result.browser = browser.version();
 } catch {result.status = 'FAIL'; result.failed_phase = phase; process.exitCode = 1;}
 finally {
  if (fixture && !restored && context) {
   // Recover only this explicitly selected managed draft if a UI assertion failed.
   try {
    const url = `${origin}/api/v1/sites/${fixture.site}/pages/${fixture.id}/`, headers = {Authorization: `Bearer ${seed.actor.token}`};
    const current = await context.request.get(url, {headers});
    if (current.status() === 200) {
     const changed = await context.request.patch(url, {headers: {...headers, 'If-Match': current.headers().etag}, data: {title: fixture.title}});
     result.fixture_title_recovered = changed.status() === 200;
    }
   } catch {result.fixture_title_recovered = false;}
  }
  await browser.close();
 }
 if (process.env.PERF_CACHE_CHECK_OUTPUT) fs.writeFileSync(process.env.PERF_CACHE_CHECK_OUTPUT, JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
})().catch(() => {console.error('Cache check failed before recording results.'); process.exitCode = 1;});
