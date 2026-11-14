/* Published frozen sidebar, two-host isolation, responsive/keyboard and axe checks. */
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async () => {
  const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
  const out = 'docs/qa/reusable-sidebars-2026-11-14';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'] });
  const page = await browser.newPage(); page.setDefaultTimeout(60000);
  const results = [];
  try {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [path, layout] of [['full-width', 'LEFT_SIDEBAR'], ['shared-sidebar', 'RIGHT_SIDEBAR']]) {
        await page.goto(`http://${seed.host}/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const shell = page.locator(`[data-page-layout="${layout}"]`);
        await shell.getByRole('heading', { name: 'Department sidebar', exact: true }).waitFor();
        assert.equal(await shell.getByText('Next draft sidebar name').count(), 0);
        const link = shell.getByRole('link', { name: 'Student support', exact: true });
        assert.equal(await link.getAttribute('href'), '/support');
        const article = await shell.locator('article').boundingBox(), aside = await shell.locator('aside').boundingBox();
        if (width < 900) assert(aside.y >= article.y + article.height);
        else if (layout === 'LEFT_SIDEBAR') assert(aside.x + aside.width <= article.x);
        else assert(article.x + article.width <= aside.x);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('body').click({ position: { x: 2, y: 2 } });
        let reached = false;
        for (let step = 0; step < 20; step++) {
          await page.keyboard.press('Tab');
          if (await link.evaluate(element => document.activeElement === element)) { reached = true; break; }
        }
        assert(reached, 'Frozen navigation is reachable with Tab');
        await page.addScriptTag({ path: process.env.UOG_QA_AXE_PATH });
        const scan = await page.evaluate(async () => {
          const result = await axe.run('[data-page-layout]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
          return { violations: result.violations.map(item => ({ id: item.id, impact: item.impact })), incomplete: result.incomplete.length };
        });
        assert.deepEqual(scan.violations, []);
        await page.screenshot({ path: `${out}/published-${layout.toLowerCase()}-${width}.png`, fullPage: true });
        results.push({ path, layout, width, status: 'PASS', keyboard: 'PASS', ...scan });
      }
    }
    await page.goto(`http://${seed.other_host}/full-width`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-page-layout="FULL_WIDTH"]').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Department sidebar', exact: true }).count(), 0);
    results.push({ name: 'Independent Site is unchanged', status: 'PASS' });
  } finally {
    fs.writeFileSync(`${out}/browser-public.json`, JSON.stringify({ run: seed.run, browser: browser.version(), results }, null, 2));
    await browser.close();
  }
  console.log(`${results.length} public responsive, frozen-content and isolation checks passed`);
})().catch(error => { console.error(error.message.slice(0, 600)); process.exitCode = 1; });
