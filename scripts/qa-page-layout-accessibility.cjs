/* Public shell accessibility and real Tab traversal, without authentication. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);
(async () => {
  const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--host-resolver-rules=MAP *.uog.local 127.0.0.1'] });
  const page = await browser.newPage();
  const results = [];
  try {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const layout of ['FULL_WIDTH', 'LEFT_SIDEBAR', 'RIGHT_SIDEBAR']) {
        await page.goto(`http://${seed.host}/${layout.toLowerCase().replaceAll('_', '-')}`);
        await page.locator(`[data-page-layout="${layout}"]`).waitFor();
        if (layout !== 'FULL_WIDTH') {
          const home = page.getByRole('link', { name: 'Site home', exact: true });
          await home.focus();
          await page.keyboard.press('Tab');
          assert(await page.locator('aside nav a').nth(1).evaluate(element => document.activeElement === element));
        }
        await page.addScriptTag({ path: process.env.UOG_QA_AXE_PATH });
        const scan = await page.evaluate(async () => {
          const result = await axe.run('[data-page-layout]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
          return { violations: result.violations.map(v => ({ id: v.id, impact: v.impact })), passes: result.passes.length, incomplete: result.incomplete.length };
        });
        assert.deepEqual(scan.violations, []);
        results.push({ width, layout, ...scan, status: 'PASS' });
      }
    }
  } finally {
    fs.writeFileSync('docs/qa/page-layouts-2026-11-14/accessibility-results.json', JSON.stringify({ browser: browser.version(), scope: 'Page shell; automated WCAG A/AA scan and sidebar Tab traversal', results }, null, 2));
    await browser.close();
  }
  console.log(`${results.length} viewport/layout accessibility checks passed`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
