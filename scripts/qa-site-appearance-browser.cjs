const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);

const host = process.env.UOG_QA_SITE_HOST || 'informatics.uog.local';
const origin = `http://${host}`;
const output = process.env.UOG_QA_OUTPUT || path.resolve('docs/qa/site-appearance-e2e');
const logoPath = '/api/v1/site-context/identity/logo/';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKc8AAAAASUVORK5CYII=',
  'base64',
);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-proxy-server', `--host-resolver-rules=MAP ${host} 127.0.0.1`],
  });
  const results = [];
  const pass = (name) => {
    results.push({ name, status: 'PASS' });
    console.log(`${name} PASS`);
  };
  let activeLogo = null;
  let imageMode = 'valid';
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route(`${origin}/api/v1/site-context/`, async (route) => {
      const upstream = await route.fetch({
        url: 'http://localhost/api/v1/site-context/',
        headers: { Host: host },
      });
      assert.equal(upstream.status(), 200, 'Site context must resolve from the request hostname');
      const body = await upstream.json();
      body.configuration = {
        ...body.configuration,
        display_name: 'Appearance E2E Site',
        logo_url: activeLogo,
      };
      await route.fulfill({ response: upstream, json: body });
    });
    await context.route(`${origin}${logoPath}`, async (route) => {
      if (imageMode === 'valid') {
        await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
      } else {
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => console.error(`browser page error: ${error.message}`));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Site context is host-resolved in the server layout. The browser refreshes
    // it on focus so this test can model a saved configuration without copying
    // logo settings into a Page document.
    const refreshContext = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshContext();
    await page.getByText('Appearance E2E Site', { exact: true }).waitFor();
    await page.locator('footer [data-site-branding="INFORMATICS"]').waitFor();
    assert.equal(await page.locator('header img').count(), 0);
    assert.match(await page.locator('header').innerText(), /UoG/);
    await page.screenshot({ path: path.join(output, 'fallback-branding.png'), fullPage: true });
    pass('A Site without a configured logo renders approved UoG fallback branding');

    activeLogo = logoPath;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await refreshContext();
    const logo = page.locator('header img');
    await logo.waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('header img');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
    assert.equal(await logo.getAttribute('src'), logoPath);
    await page.screenshot({ path: path.join(output, 'site-logo.png'), fullPage: true });
    pass('An approved public Site logo renders from the fixed Site-context endpoint');

    imageMode = 'missing';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await refreshContext();
    await page.waitForFunction(() => document.querySelector('header img') === null);
    assert.match(await page.locator('header').innerText(), /UoG/);
    await page.screenshot({ path: path.join(output, 'unavailable-logo-fallback.png'), fullPage: true });
    pass('An unavailable Site logo falls back without exposing a storage URL');

    activeLogo = 'https://private.example/media/private-logo.png';
    imageMode = 'valid';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await refreshContext();
    assert.equal(await page.locator('header img').count(), 0);
    assert.match(await page.locator('header').innerText(), /UoG/);
    pass('A private or remote media URL is ignored and never rendered as Site branding');

    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ host, results }, null, 2));
    console.log(JSON.stringify({ host, results }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
