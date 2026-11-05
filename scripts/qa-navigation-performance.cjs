/* Read-only, real-browser navigation timing; credentials arrive on stdin. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');
(async () => {
  const { session } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const actor = session.actors.platform;
  const output = path.resolve('docs/qa/admin-navigation-performance-2026-11-04');
  fs.mkdirSync(output, { recursive: true });
  const name = process.env.UOG_QA_PERF_LABEL || 'before';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-proxy-server'] });
  const samples = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(60000);
    await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(actor.username); await page.locator('#password').fill(actor.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'));
    await page.getByRole('navigation', { name: 'Admin sections', exact: true }).getByRole('link').filter({ hasText: 'Organizations' }).waitFor();
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST') posts++; });
    for (let pass = 0; pass < Number(process.env.UOG_QA_PERF_PASSES || 2); pass++) {
      for (const [label, caption] of [['Organizations', 'Organization units'], ['Sites', 'Managed sites'], ['Domains', 'Configured domains']]) {
        const initialPosts = posts, started = performance.now();
        await page.getByRole('navigation', { name: 'Admin sections', exact: true }).getByRole('link').filter({ hasText: label }).click();
        await page.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor();
        const headingMs = Math.round(performance.now() - started);
        await page.waitForFunction(caption => {
          const table = document.querySelector(`table[aria-label="${caption}"]`);
          return table && table.querySelector('tbody')?.innerText.trim() && !table.querySelector('.MuiSkeleton-root');
        }, caption, { timeout: 90000 });
        const rowsMs = Math.round(performance.now() - started);
        if (label === 'Sites') {
          await page.waitForTimeout(100);
          await page.waitForFunction(() => !document.querySelector('table[aria-label="Managed sites"] [aria-live="polite"]'), null, { timeout: 90000 });
        }
        const sample = { pass, section: label, heading_ms: headingMs, rows_ms: rowsMs, complete_ms: Math.round(performance.now() - started), server_action_posts: posts - initialPosts };
        samples.push(sample); console.log(JSON.stringify(sample));
      }
    }
  } finally {
    fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify({ samples }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error('Navigation timing failed: ' + error.name); process.exitCode = 1; });
