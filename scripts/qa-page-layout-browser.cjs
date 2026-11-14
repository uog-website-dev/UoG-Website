/* Real Edge / Next.js verification. Private identity data arrives on stdin. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);

(async () => {
  const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
  const output = 'docs/qa/page-layouts-2026-11-14';
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--host-resolver-rules=MAP *.uog.local 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const results = [];
  const pass = name => { results.push({ name, status: 'PASS' }); console.log(name + ' PASS'); };
  try {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const layout of ['FULL_WIDTH', 'LEFT_SIDEBAR', 'RIGHT_SIDEBAR']) {
        await page.goto(`http://${seed.host}/${layout.toLowerCase().replaceAll('_', '-')}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        console.log('Checking '+layout+' at '+width);
        const shell = page.locator(`[data-page-layout="${layout}"]`);
        await shell.waitFor();
        await shell.getByText('Retained builder content', { exact: true }).waitFor();
        if (layout === 'FULL_WIDTH') assert.equal(await shell.locator('aside').count(), 0);
        else {
          const article = await shell.locator('article').boundingBox();
          const sidebar = await shell.locator('aside').boundingBox();
          if (width < 900) assert(sidebar.y >= article.y + article.height);
          else if (layout === 'LEFT_SIDEBAR') assert(sidebar.x + sidebar.width <= article.x);
          else assert(article.x + article.width <= sidebar.x);
          const home = shell.getByRole('link', { name: 'Site home', exact: true });
          await home.focus();
          assert(await home.evaluate(element => document.activeElement === element));
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `${output}/${layout.toLowerCase()}-${width}.png`, fullPage: true });
        pass(`${layout} at ${width}px: content, position, overflow and keyboard`);
      }
    }
    await page.goto(`http://${seed.other_host}/full-width`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-page-layout="FULL_WIDTH"]').waitFor();
    assert.equal(await page.locator('aside[aria-label="Page navigation"]').count(), 0);
    pass('Independent Site keeps its full-width layout');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(seed.member.username);
    await page.locator('#password').fill(seed.member.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 90000 });
    const edit = `http://localhost/admin/sites/${seed.site}/admin/pages/${seed.draft}/edit`;
    await page.goto(edit, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('combobox', { name: 'Page layout' }).click();
    await page.getByRole('option', { name: 'Left Sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await page.locator('[data-page-layout="LEFT_SIDEBAR"]').getByText('Retained builder content', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/editor-draft-preview.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith('/pages'), { timeout: 90000 });
    await page.goto(edit, { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: 'Page layout' }).filter({ hasText: 'Left Sidebar' }).waitFor();
    pass('Real Editor selects, previews, saves and reloads the visual draft');
    await page.goto(`http://${seed.host}/full-width`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-page-layout="FULL_WIDTH"]').waitFor();
    pass('Saved draft layout does not replace published full-width snapshot');
  } catch (error) {
    results.push({ name: 'Browser rehearsal', status: 'FAIL', error: error.message.slice(0, 600) });
    console.error(error.message.slice(0, 600));
    console.error((await page.locator('body').innerText()).slice(0, 600));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(`${output}/browser-results.json`, JSON.stringify({ run: seed.run, browser: browser.version(), results }, null, 2));
    await browser.close();
  }
})();
