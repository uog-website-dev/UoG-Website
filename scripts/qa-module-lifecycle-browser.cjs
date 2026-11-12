/* Writable localhost acceptance. Dedicated fixtures from qa-module-lifecycle.py
 * arrive on stdin; never print credentials or retain them in evidence. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const state = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert(state.sites.length === 3 && state.sites.every(s => s.code.startsWith(state.run.toUpperCase() + '-')));
  const output = path.resolve(process.env.UOG_QA_OUTPUT || 'docs/qa/module-fixes-2026-11-10');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.UOG_QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + state.host + ' 127.0.0.1'] });
  const results = [];
  const pages = {};
  let publicPage;
  let step = 'login';
  async function mark(name, run) {
    step = name;
    console.log(name + ': running');
    await run();
    results.push({ name, status: 'PASS' });
    console.log(name + ': PASS');
  }
  async function actor(name) {
    if (pages[name]) return pages[name];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto('http://localhost/admin');
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(state.actors[name].username);
    await page.locator('#password').fill(state.actors[name].password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'));
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    pages[name] = page;
    return page;
  }
  const postsUrl = site => 'http://localhost/admin/sites/' + site.id + '/admin/posts';
  async function change(action, sites) {
    const page = await actor('platform');
    await page.goto('http://localhost/admin/modules?tab=sites');
    await page.getByRole('textbox', { name: 'Site', exact: true }).fill(state.run);
    await page.getByRole('search', { name: 'Site filters' }).getByRole('button', { name: 'Apply', exact: true }).click();
    for (const site of sites) await page.getByRole('checkbox', { name: 'Select ' + site.name, exact: true }).check();
    await page.getByRole('combobox', { name: 'Modules', exact: true }).click();
    await page.getByRole('option').filter({ hasText: /^POSTS/ }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Preview ' + action.toLowerCase(), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('table', { name: 'Expected result per Site' }).waitFor();
    assert.equal(await dialog.getByRole('table').getByRole('row').count(), sites.length + 1);
    await dialog.getByRole('textbox', { name: /Reason/ }).fill('Module lifecycle acceptance ' + state.run);
    const phrase = dialog.getByRole('textbox', { name: 'Type ' + action, exact: true });
    if (await phrase.count()) await phrase.fill(action);
    await dialog.getByRole('button', { name: new RegExp('^' + (action === 'ENABLE' ? 'Enable' : 'Disable') + ' on ') }).click();
    await dialog.getByText('The operation was committed.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
  async function publicStatus(expected) {
    const page = await actor('platform');
    const response = await page.request.get('http://localhost/api/v1/site-context/posts/' + state.slug + '/', { headers: { Host: state.host } });
    assert.equal(response.status(), expected);
    if (expected === 200) assert.equal((await response.json()).title, state.title);
    publicPage ??= await browser.newPage();
    await publicPage.goto('http://' + state.host + '/posts/' + state.slug);
    if (expected === 200) await publicPage.getByRole('heading', { name: state.title, exact: true }).waitFor({ timeout: 60000 });
    else await publicPage.getByText('This Site has no published post to show.', { exact: true }).waitFor({ timeout: 60000 });
  }
  try {
    await mark('enable-selected-sites', () => change('ENABLE', state.sites.slice(0, 2)));
    await mark('site-navigation-and-unselected-isolation', async () => {
      const page = await actor('author');
      for (const site of state.sites.slice(0, 2)) {
        await page.goto(postsUrl(site));
        await page.getByRole('navigation', { name: 'Site sections', exact: true }).getByRole('link').filter({ hasText: 'Posts' }).waitFor();
        await page.getByRole('button', { name: 'Create Post', exact: true }).waitFor();
      }
      const platform = await actor('platform');
      await platform.goto(postsUrl(state.sites[2]));
      await platform.getByText('Posts are not enabled for this Site.', { exact: true }).waitFor();
    });
    await mark('create-and-submit-post', async () => {
      const page = await actor('author');
      await page.goto(postsUrl(state.sites[0]));
      await page.getByRole('button', { name: 'Create Post', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create Post', exact: true });
      await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(state.title);
      await dialog.getByRole('textbox', { name: 'Slug', exact: true }).fill(state.slug);
      await dialog.getByRole('button', { name: 'Add paragraph', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Block 1 JSON', exact: true }).fill('{"type":"paragraph","html":"<p>Retained module acceptance content</p>"}');
      await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Submit ' + state.title + ' for review', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm submit', exact: true }).click();
      await page.getByText('In review', { exact: true }).waitFor();
    });
    await mark('approve-and-publish-as-distinct-users', async () => {
      for (const [name, action, status] of [['reviewer', 'Approve', 'Approved'], ['publisher', 'Publish', 'Published']]) {
        const page = await actor(name);
        await page.goto(postsUrl(state.sites[0]));
        await page.getByRole('button', { name: action + ' ' + state.title, exact: true }).click();
        await page.getByRole('button', { name: 'Confirm ' + action.toLowerCase(), exact: true }).click();
        await page.getByRole('cell', { name: status, exact: true }).waitFor();
      }
      await publicStatus(200);
    });
    await mark('disable-and-enforce', async () => {
      await change('DISABLE', [state.sites[0]]);
      const page = await actor('author');
      await page.goto(postsUrl(state.sites[0]));
      await page.getByText('Posts are not enabled for this Site.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('navigation', { name: 'Site sections', exact: true }).getByRole('link').filter({ hasText: 'Posts' }).count(), 0);
      await publicStatus(404);
    });
    await mark('restore-retained-publication', async () => {
      await change('ENABLE', [state.sites[0]]);
      const page = await actor('author');
      await page.goto(postsUrl(state.sites[0]));
      await page.getByRole('cell', { name: 'Published', exact: true }).waitFor();
      await page.getByText(state.title, { exact: true }).waitFor();
      await publicStatus(200);
    });
    await mark('audit-history', async () => {
      const page = await actor('platform');
      await page.goto('http://localhost/admin/modules?tab=history');
      await page.getByText('Module lifecycle acceptance ' + state.run, { exact: true }).first().waitFor();
      assert.equal(await page.getByText('Module lifecycle acceptance ' + state.run, { exact: true }).count(), 3);
      const latest = page.getByRole('row').filter({ hasText: 'Module lifecycle acceptance ' + state.run }).first();
      await latest.getByRole('button', { name: /^Details for operation/ }).click();
      const details = page.getByRole('dialog', { name: 'Operation details', exact: true });
      await details.getByText(state.actors.platform.username, { exact: true }).waitFor();
      const changes = details.getByRole('table', { name: 'Changes made by this operation' });
      await changes.getByRole('cell', { name: 'Disabled', exact: true }).waitFor();
      await changes.getByRole('cell', { name: 'Enabled', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'operation-history.png') });
    });
    await mark('site-admin-central-access-denied', async () => {
      const page = await actor('author');
      await page.goto('http://localhost/admin/modules');
      await page.getByText('Central module activation is not available for this account.', { exact: true }).waitFor();
      if (state.actors.author.access_token) {
        const denied = await page.request.post('http://localhost/api/v1/site-modules/bulk-preview/', {
          headers: { Authorization: 'Bearer ' + state.actors.author.access_token },
          data: { action: 'DISABLE', modules: ['POSTS'], scope: { type: 'SITE', site_ids: [state.sites[0].id] } },
        });
        assert.equal(denied.status(), 403);
      }
    });
  } catch (error) {
    results.push({ name: step, status: 'FAIL', error: error.name });
    console.error(step + ': FAIL (' + error.name + ')');
    console.error(error.message.split('\n')[0]);
    for (const [name, page] of Object.entries(pages)) await page.screenshot({ path: path.join(output, name + '-failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ run: state.run, results }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error('Lifecycle harness failed: ' + error.name); process.exitCode = 1; });
