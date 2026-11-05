/* Credentials arrive on stdin and are never included in browser evidence. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const { session, state } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const output = path.resolve('docs/qa/site-workspace-2026-11-04');
  const mode = process.env.UOG_QA_WORKSPACE_MODE || 'full';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-proxy-server'] });
  const results = [];
  const save = () => fs.writeFileSync(path.join(output, mode === 'full' ? 'browser-results.json' : 'browser-' + mode + '-results.json'), JSON.stringify({ run: state.run, build: state.build, results }, null, 2));
  async function check(id, page, fn) {
    try { await fn(); results.push({ id, status: 'PASS' }); console.log(id + ': PASS'); return true; }
    catch (error) {
      results.push({ id, status: 'FAIL', actual: error.name + ': browser assertion failed; see screenshot' });
      console.log(id + ': FAIL (' + error.name + ')');
      await page.screenshot({ path: path.join(output, id + '-failure.png') }).catch(() => {});
      return false;
    } finally { save(); }
  }
  async function login(page, actor) {
    await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(actor.username);
    await page.locator('#password').fill(actor.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 60000 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ timeout: 60000 });
  }
  async function metric(region, label, expected) {
    const value = region.locator('dl > div').filter({ has: region.page().getByText(label, { exact: true }) }).locator('dd');
    await value.getByText(String(expected), { exact: true }).waitFor({ timeout: 60000 });
  }
  async function responsiveChecks(page) {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
      await check('responsive-keyboard-' + name, page, async () => {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(400);
        if (width < 900) {
          const open = page.getByRole('button', { name: 'Open navigation menu', exact: true });
          await open.focus(); await page.keyboard.press('Enter');
          const close = page.getByRole('button', { name: 'Close navigation menu', exact: true });
          await close.waitFor();
          const selector = page.getByRole('combobox', { name: 'Workspace', exact: true });
          await selector.locator(`option[value="site:${state.site.id}"]`).waitFor({ state: 'attached', timeout: 60000 });
          await selector.focus();
          if (await selector.inputValue() !== 'site:' + state.site.id) throw new Error('Wrong mobile workspace');
          await page.keyboard.press('Escape'); await close.waitFor({ state: 'hidden' });
        }
        const main = page.getByRole('main');
        await main.evaluate(node => { node.scrollTop = 600; });
        await page.waitForTimeout(300);
        const active = page.getByRole('region', { name: 'Active Site', exact: true });
        const frame = await main.boundingBox(), identity = await active.boundingBox();
        if (!frame || !identity || identity.y < frame.y - 2 || identity.y + identity.height > height) throw new Error('Active Site lost on scroll');
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Horizontal overflow');
        const signOut = await page.getByRole('button', { name: 'Sign out', exact: true }).boundingBox();
        if (!signOut || signOut.x < 0 || signOut.x + signOut.width > width + 2) throw new Error('Sign out clipped outside viewport');
        await page.screenshot({ path: path.join(output, 'site-menus-' + name + '.png') });
      });
    }
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    if (!await check('site-admin-login', page, () => login(page, session.actors.siteadmin))) return;
    if (mode === 'responsive') {
      await page.goto('http://localhost/admin/sites/' + state.site.id + '/admin/menus', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('list', { name: 'Menus for this Site', exact: true }).waitFor({ timeout: 60000 });
      await responsiveChecks(page);
      return;
    }
    await check('authorized-workspace-choices', page, async () => {
      const selector = page.getByRole('combobox', { name: 'Workspace', exact: true });
      await selector.locator(`option[value="site:${state.site.id}"]`).waitFor({ state: 'attached' });
      const choices = await selector.locator('option:not([disabled])').evaluateAll(nodes => nodes.map(node => node.value));
      if (JSON.stringify(choices) !== JSON.stringify(['site:' + state.site.id])) throw new Error('Unauthorized workspace choice');
      const nav = page.getByRole('navigation', { name: 'Admin sections', exact: true });
      if (await nav.getByRole('link').count()) throw new Error('Platform navigation exposed');
      await selector.selectOption('site:' + state.site.id);
      await page.waitForURL('**/admin/sites/' + state.site.id + '/admin', { timeout: 60000 });
    });
    await check('site-identity-and-effective-navigation', page, async () => {
      const runtime = await page.request.get('http://localhost/admin/api/workspace/?site=' + state.site.id);
      fs.writeFileSync(path.join(output, 'runtime-workspace.json'), JSON.stringify(await runtime.json(), null, 2));
      const active = page.getByRole('region', { name: 'Active Site', exact: true });
      await active.getByRole('heading', { name: state.site.name, exact: true }).waitFor();
      await active.getByText(state.site.code, { exact: true }).waitFor();
      if (!(await active.innerText()).includes('Organization')) throw new Error('Organization context missing');
      const nav = page.getByRole('navigation', { name: 'Site sections', exact: true });
      for (const [code, label] of [['PAGES', 'Pages'], ['POSTS', 'Posts'], ['MENUS', 'Menus']]) {
        const available = state.modules.some(row => row.module_code === code && row.is_available);
        const link = nav.getByRole('link').filter({ hasText: label });
        if (available) await link.waitFor();
        else if (await link.count()) throw new Error('Disabled module navigation exposed');
      }
      const denied = await page.request.get('http://localhost/admin/api/workspace/?site=' + state.other.id);
      const payload = await denied.json();
      if (payload.site !== null || payload.sites.some(row => row.id === state.other.id)) throw new Error('Foreign workspace data leaked');
    });
    await check('api-driven-dashboard', page, async () => {
      const pages = page.getByRole('region', { name: 'Pages', exact: true });
      const counts = state.expected_page_counts;
      await metric(pages, 'Total', Object.values(counts).reduce((a, b) => a + b, 0));
      await metric(pages, 'Draft', counts.DRAFT);
      await metric(pages, 'Published', counts.PUBLISHED);
      const menus = page.getByRole('region', { name: 'Menus', exact: true });
      for (const [label, count] of Object.entries(state.expected_menus)) await metric(menus, label, count);
      if (!state.modules.some(row => row.module_code === 'POSTS' && row.is_available) && await page.getByRole('region', { name: 'Posts', exact: true }).count()) throw new Error('Disabled summary exposed');
      await page.screenshot({ path: path.join(output, 'site-dashboard-desktop.png') });
    });
    await check('create-page-quick-action', page, async () => {
      await page.getByRole('link', { name: 'Create page', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/admin/sites/' + state.site.id + '/admin/pages', { timeout: 60000 });
      const dialog = page.getByRole('dialog', { name: 'Create Page', exact: true });
      await dialog.getByRole('textbox', { name: /^Title/ }).fill(state.title);
      await dialog.getByRole('textbox', { name: /^Slug/ }).fill(state.slug);
      await dialog.getByRole('button', { name: 'Add paragraph block', exact: true }).click();
      await dialog.getByRole('textbox', { name: /Block 1 JSON/ }).fill('{"type":"paragraph","html":"<p>Workspace QA publishing check</p>"}');
      await dialog.getByRole('button', { name: 'Create Page', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 60000 });
      await page.getByText(state.title, { exact: true }).first().waitFor();
    });
    await check('workspace-preserved-and-dashboard-refreshed', page, async () => {
      const nav = page.getByRole('navigation', { name: 'Site sections', exact: true });
      await nav.getByRole('link').filter({ hasText: 'Dashboard' }).click();
      await page.waitForURL('**/admin/sites/' + state.site.id + '/admin');
      const pages = page.getByRole('region', { name: 'Pages', exact: true });
      await metric(pages, 'Draft', state.expected_page_counts.DRAFT + 1);
      await nav.getByRole('link').filter({ hasText: 'Menus' }).click();
      await page.waitForURL('**/admin/sites/' + state.site.id + '/admin/menus');
      await page.getByRole('list', { name: 'Menus for this Site', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Active Site' }).getByRole('heading', { name: state.site.name, exact: true }).waitFor();
    });
    await responsiveChecks(page);
    await context.close();

    const platformContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const platformPage = await platformContext.newPage();
    platformPage.setDefaultTimeout(30000);
    if (await check('platform-admin-login', platformPage, () => login(platformPage, session.actors.platform))) {
      await check('platform-and-site-switching', platformPage, async () => {
        const selector = platformPage.getByRole('combobox', { name: 'Workspace', exact: true });
        await selector.locator('option[value="platform"]').waitFor({ state: 'attached' });
        await platformPage.getByRole('navigation', { name: 'Admin sections', exact: true }).getByRole('link').filter({ hasText: 'Organizations' }).waitFor();
        await selector.selectOption('site:' + state.other.id);
        await platformPage.waitForURL('**/admin/sites/' + state.other.id + '/admin');
        await platformPage.getByRole('region', { name: 'Active Site' }).getByRole('heading', { name: state.other.name, exact: true }).waitFor();
        await platformPage.getByRole('navigation', { name: 'Site sections' }).getByRole('link').filter({ hasText: 'Pages' }).click();
        await platformPage.waitForURL('**/admin/sites/' + state.other.id + '/admin/pages');
        if (await platformPage.getByText(state.title, { exact: true }).count()) throw new Error('Foreign Page in Site B');
        await selector.selectOption('platform');
        await platformPage.waitForURL(url => url.pathname === '/admin' || url.pathname === '/admin/');
        await platformPage.screenshot({ path: path.join(output, 'platform-dashboard.png') });
      });
    }
    await platformContext.close();
  } finally {
    save(); await browser.close();
    if (results.some(row => row.status === 'FAIL')) process.exitCode = 1;
  }
})().catch(error => { console.error('Workspace browser harness failed: ' + error.name); process.exitCode = 1; });
