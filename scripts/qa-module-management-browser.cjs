/* Real-stack, read-only central management QA. Private credentials use stdin. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);

(async () => {
  const { session, state } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const output = path.join(process.cwd(), 'docs/qa/module-management-audit-2026-11-04');
  const results = [];
  let step = '';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  async function check(id, page, run) {
    try { await run(); results.push({ id, status: 'PASS' }); console.log(id + ': PASS'); }
    catch (error) { results.push({ id, status: 'FAIL', error: error.name, step }); console.log(id + ': FAIL (' + error.name + ', ' + step + ')'); }
    await page.screenshot({ path: path.join(output, id + '.png') });
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ run: session.run, build: state.build, date: new Date().toISOString(), results }, null, 2));
  }
  async function login(page, actor) {
    await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(actor.username);
    await page.locator('#password').fill(actor.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 120000 });
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await login(page, session.actors.platform);
    await check('registry', page, async () => {
      await page.goto('http://localhost/admin/modules', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.getByRole('button', { name: 'Details for PAGES', exact: true }).waitFor();
      assert(await page.getByRole('tab', { name: 'Registry', exact: true }).getAttribute('aria-selected') === 'true');
    });
    await check('selection-preview', page, async () => {
      step = 'open-site-management';
      await page.getByRole('tab', { name: 'Site module management', exact: true }).click();
      step = 'select-site';
      const selected = page.getByRole('checkbox', { name: `Select ${state.site.name}`, exact: true });
      await selected.check();
      step = 'select-module';
      await page.getByRole('combobox', { name: 'Modules', exact: true }).click();
      await page.getByRole('option').filter({ hasText: /^MENUS/ }).click();
      await page.keyboard.press('Escape');
      step = 'open-preview';
      await page.getByRole('button', { name: 'Preview disable', exact: true }).click();
      const dialog = page.getByRole('dialog');
      step = 'read-preview';
      await dialog.getByText('Matching Sites', { exact: true }).waitFor();
      assert(await dialog.getByRole('table', { name: 'Expected result per Site' }).getByText(state.site.name, { exact: true }).count() === 1);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
      await check('responsive-keyboard-' + name, page, async () => {
        step = 'activate-history-' + name;
        await page.setViewportSize({ width, height });
        await page.getByRole('tab', { name: 'Site module management', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await page.getByRole('tab', { name: 'History', exact: true, selected: true }).waitFor();
        assert(await page.getByRole('tab', { name: 'History', exact: true }).getAttribute('aria-selected') === 'true');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await page.getByRole('tab', { name: 'Site module management', exact: true }).click();
      });
    }
    const restricted = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const sitePage = await restricted.newPage();
    sitePage.setDefaultTimeout(60000);
    await login(sitePage, session.actors.siteadmin);
    await check('site-admin-denied', sitePage, async () => {
      await sitePage.goto('http://localhost/admin/modules', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await sitePage.getByText('Central module activation is not available for this account.', { exact: true }).waitFor();
      assert(await sitePage.getByRole('button', { name: 'Preview enable', exact: true }).count() === 0);
    });
  } finally { await browser.close(); }
  if (results.some(row => row.status === 'FAIL')) process.exitCode = 1;
})().catch(error => { console.error('Module browser QA failed: ' + error.name); process.exitCode = 1; });
