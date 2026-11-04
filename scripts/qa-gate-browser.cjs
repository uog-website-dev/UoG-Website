/* Real Edge/Chromium acceptance probes. Credentials arrive only on stdin. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const state = input.state;
  const actor = input.session?.actors.admin;
  const mode = process.env.UOG_QA_MODE || 'full';
  const output = path.resolve(process.env.UOG_QA_OUTPUT || 'docs/qa/P2-QA-GATE-001/evidence');
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const save = () => fs.writeFileSync(path.join(output, mode === 'full' ? 'browser-results.json' : 'browser-' + mode + '-results.json'), JSON.stringify({ run: state.run, build: state.build, date: state.date, results }, null, 2));
  async function check(id, label, fn) {
    try {
      const detail = await fn();
      results.push({ id, label, status: 'PASS', actual: detail });
      console.log(id + ': PASS - ' + label);
    } catch (error) {
      // Never capture URLs containing OAuth codes, token values or cookies.
      results.push({ id, label, status: 'FAIL', actual: error.name + ': assertion or browser step failed; see screenshot' });
      console.log(id + ': FAIL - ' + label + ' (' + error.name + ')');
      await page.screenshot({ path: path.join(output, id + '-failure.png'), fullPage: true }).catch(() => {});
    }
    save();
  }
  try {
    if (mode === 'module') {
      await check('T11-browser-menus', 'Disabled MENUS removes public navigation', async () => {
        await page.goto('http://' + state.sites[0].host + '/qa-home', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByText('QA MAIN PUBLIC MARKER ' + state.run, { exact: true }).waitFor();
        await page.waitForTimeout(1000);
        if (await page.getByRole('navigation', { name: 'Site header', exact: true }).count()) throw new Error('Disabled navigation still rendered');
        await page.screenshot({ path: path.join(output, 'public-menus-disabled.png'), fullPage: true, animations: 'disabled' });
        return 'Real public Next.js Page remains available, while MENUS navigation is absent.';
      });
      return;
    }
    if (mode !== 'admin') {
    for (let index = 0; index < state.sites.length; index++) {
      const site = state.sites[index];
      await check('T31-' + index, 'Published Page renders for ' + site.host, async () => {
        const response = await page.goto('http://' + site.host + '/qa-home', { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (response.status() !== 200) throw new Error('Page HTTP status');
        const expected = `QA ${index === 0 ? 'MAIN' : 'COLLEGE'} PUBLIC MARKER ${state.run}`;
        await page.getByText(expected, { exact: true }).waitFor();
        const text = await page.locator('body').innerText();
        const siteCode = await page.locator('[data-site-code]').first().getAttribute('data-site-code');
        if (siteCode !== site.code) throw new Error('Site chrome ownership mismatch');
        if (text.includes(`QA ${index === 0 ? 'COLLEGE' : 'MAIN'} PUBLIC MARKER ${state.run}`)) throw new Error('Foreign Site content');
        await page.screenshot({ path: path.join(output, 'public-page-' + index + '-desktop.png'), fullPage: true });
        return 'Real Next.js client rendered this hostname’s published backend snapshot without the other Site marker.';
      });
    }
    await check('T31-post', 'Published Post renders on its Site only', async () => {
      await page.goto('http://' + state.sites[0].host + '/posts/qa-news', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByText('QA MAIN POST MARKER ' + state.run, { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'public-post.png'), fullPage: true });
      await page.goto('http://' + state.sites[1].host + '/posts/qa-news', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1800);
      if ((await page.locator('body').innerText()).includes('QA MAIN POST MARKER ' + state.run)) throw new Error('Foreign Post leak');
      return 'Own Post marker rendered; foreign hostname did not render it.';
    });
    await page.goto('http://' + state.sites[0].host + '/qa-home', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await check('T30-browser', 'Public navigation uses the owning Site Menu', async () => {
      const link = page.getByRole('link', { name: 'QA Home', exact: true });
      await link.waitFor({ state: 'visible' });
      const href = await link.getAttribute('href');
      if (href !== '/qa-home') throw new Error('Unsafe/wrong target');
      await link.click();
      return 'Rendered QA Home navigation links to the same-Site published Page.';
    });
    for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 1000]]) {
      await check('T32-' + name, name + ' layout and keyboard navigation', async () => {
        await page.setViewportSize({ width, height });
        await page.getByText('QA MAIN PUBLIC MARKER ' + state.run, { exact: true }).waitFor();
        if (width < 900) {
          const open = page.getByRole('button', { name: 'Open site header', exact: true });
          await open.focus();
          await page.keyboard.press('Enter');
          await page.getByRole('button', { name: 'Close site header', exact: true }).waitFor({ state: 'visible' });
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: 'Close site header', exact: true }).waitFor({ state: 'hidden' });
        } else {
          await page.getByRole('link', { name: 'QA Home', exact: true }).focus();
          if (!(await page.getByRole('link', { name: 'QA Home', exact: true }).evaluate(el => document.activeElement === el))) throw new Error('No keyboard focus');
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
        if (overflow) throw new Error('Horizontal overflow');
        await page.waitForTimeout(650);
        await page.screenshot({ path: path.join(output, 'public-' + name + '.png'), fullPage: true, animations: 'disabled' });
        return 'Viewport ' + width + 'x' + height + '; no horizontal overflow; keyboard control reached navigation.';
      });
    }
    if (mode === 'public') return;
    await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await check('T12-browser', 'Real Keycloak authorization-code login and Auth.js session', async () => {
      await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
      await page.locator('#username').fill(actor.username);
      await page.locator('#password').fill(actor.password);
      await page.locator('#kc-login').click();
      await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 60000 });
      await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
      const cookies = await context.cookies();
      const session = cookies.filter(cookie => cookie.name.includes('session-token'));
      if (!session.length || session.some(cookie => !cookie.httpOnly)) throw new Error('Session cookie policy');
      await page.screenshot({ path: path.join(output, 'admin-authenticated.png'), fullPage: true });
      return 'Actual Keycloak credentials/redirect succeeded; Auth.js session cookies are HTTP-only. No cookie/token values recorded.';
    });
    await check('T13-browser', 'IAM access-management UI compiles and loads', async () => {
      const response = await page.goto('http://localhost/admin/access', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !document.body.innerText.includes('Loading registered access data…') && !document.body.innerText.includes('Loading registered access data...'), null, { timeout: 60000 });
      await page.getByText('menu.read', { exact: false }).first().waitFor({ timeout: 60000 });
      const text = await page.locator('body').innerText();
      if (response.status() >= 400 || text.match(/Build Error|Module not found|not exported|No roles are visible|No effective permissions are granted/i)) throw new Error('IAM screen missing granted roles or build failed');
      await page.screenshot({ path: path.join(output, 'admin-access.png'), fullPage: true });
      return 'Access screen loaded; API delegation boundary tested independently.';
    });
    if (process.env.UOG_QA_MENU_REPAIR === '1') {
      await check('T28-browser', 'Active and inactive menus remain visible; active menu can be edited', async () => {
        await page.goto('http://localhost/admin/sites/' + state.sites[0].id, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const inventory = page.getByRole('list', { name: 'Menus for this Site', exact: true });
        await inventory.getByText('QA Inactive Footer', { exact: true }).waitFor({ timeout: 60000 });
        await inventory.getByRole('button', { name: 'Edit QA Header', exact: true }).click();
        await inventory.getByRole('textbox', { name: /Local menu name/ }).fill('QA Header Verified');
        await inventory.getByRole('button', { name: 'Save menu', exact: true }).click();
        await inventory.getByRole('button', { name: 'Edit QA Header Verified', exact: true }).waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await inventory.getByRole('button', { name: 'Edit QA Header Verified', exact: true }).waitFor({ timeout: 60000 });
        await inventory.getByText('QA Inactive Footer', { exact: true }).waitFor();
        await inventory.screenshot({ path: path.join(output, 'admin-menus-active-inactive.png'), animations: 'disabled' });
        await inventory.getByRole('button', { name: 'Edit QA Header Verified', exact: true }).click();
        await inventory.getByRole('textbox', { name: /Local menu name/ }).fill('QA Header');
        await inventory.getByRole('button', { name: 'Save menu', exact: true }).click();
        await inventory.getByRole('button', { name: 'Edit QA Header', exact: true }).waitFor();
        return 'Activated header and inactive footer rendered together; header rename persisted across a real browser reload and was restored through the same UI.';
      });
    }
    await check('T12-logout', 'Keycloak/Auth.js sign-out clears session', async () => {
      await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 60000 });
      await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).waitFor();
      if ((await context.cookies()).some(cookie => cookie.name.includes('session-token'))) throw new Error('Session not cleared');
      await page.screenshot({ path: path.join(output, 'admin-signed-out.png'), fullPage: true });
      return 'Auth.js session cleared and protected console asks for sign-in again.';
    });
  } finally {
    save();
    await browser.close();
    if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
  }
})().catch(error => { console.error('Browser harness failed: ' + error.name); process.exitCode = 1; });
