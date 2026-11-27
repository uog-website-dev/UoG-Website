/* Public Documents & Files browser E2E, responsive checks, and axe scan. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.UOG_QA_TOOLS, 'node_modules', 'playwright-core'));

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs', 'qa', 'P4-DOC-009', 'evidence');
const fixtures = path.join(root, 'docs', 'qa', 'P4-DOC-009', 'fixtures');
fs.mkdirSync(evidence, { recursive: true });
const siteTargets = [
  { id: 2, host: 'www.uog.local', code: 'MAIN', label: 'Main University' },
  { id: 3, host: 'informatics.uog.local', code: 'INFORMATICS', label: 'Informatics College' },
];
const mime = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
const fixtureNames = {
  MAIN: { pdf: 'policy.pdf', login: 'admissions-login.pdf', docx: 'student-handbook.docx', xlsx: 'budget-template.xlsx', zip: 'records-package.zip' },
  INFORMATICS: { pdf: 'college-regulations.pdf', login: 'registrar-login.pdf', docx: 'faculty-handbook.docx', xlsx: 'course-schedule.xlsx', zip: 'registrar-forms.zip' },
};
const results = [];

async function waitForCall(calls, predicate, description) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (calls.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}. Calls: ${calls.join(' | ')}`);
}

function documentRows(site) {
  const prefix = site.code === 'MAIN' ? 'Main University' : 'College of Informatics';
  const baseRows = [
    { id: `${site.id}-policy`, title: `${prefix} Public Policy`, type: 'pdf', category: 'policies', login: false },
    { id: `${site.id}-login`, title: `${prefix} Login Required Guide`, type: 'pdf', category: 'student-resources', login: true },
    { id: `${site.id}-handbook`, title: `${prefix} Student Handbook`, type: 'docx', category: 'student-resources', login: false },
    { id: `${site.id}-budget`, title: `${prefix} Budget Template`, type: 'xlsx', category: 'forms', login: false },
    { id: `${site.id}-records`, title: `${prefix} Records Package`, type: 'zip', category: 'forms', login: false },
  ].map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.title.toLowerCase().replaceAll(' ', '-'),
    description: `Synthetic QA details for ${row.title}.`,
    version: '2026-QA',
    effective_date: '2026-11-01',
    published_at: '2026-11-01T12:00:00Z',
    require_login_to_download: row.login,
    file_type: row.type === 'pdf' ? mime.pdf : mime[row.type],
    file_size: 2048,
    file_url: `/api/v1/site-context/documents/${row.id}/file/`,
    categories: [{ id: `${site.id}-${row.category}`, name: row.category === 'policies' ? 'Policies' : row.category === 'forms' ? 'Forms' : 'Student resources', slug: row.category }],
    qaFixture: fixtureNames[site.code][row.login ? 'login' : row.type],
  }));
  const additionalRows = Array.from({ length: 20 }, (_, index) => {
    const original = baseRows[index % baseRows.length];
    const title = `${original.title} Archive Copy ${index + 1}`;
    return { ...original, id: `${site.id}-archive-${index + 1}`, title, slug: title.toLowerCase().replaceAll(' ', '-') };
  });
  return [...baseRows, ...additionalRows];
}

async function verifySite(browser, site) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const rows = documentRows(site);
  const calls = [];
  const fileCalls = [];
  await page.route('**/api/v1/site-context/documents/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/categories/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.flatMap((row) => row.categories).filter((item, index, all) => all.findIndex((candidate) => candidate.slug === item.slug) === index)) });
      return;
    }
    const query = (url.searchParams.get('search') || '').toLowerCase();
    const category = url.searchParams.get('category') || '';
    const type = url.searchParams.get('file_type') || '';
    let filtered = rows.filter((row) => (!query || row.title.toLowerCase().includes(query)) && (!category || row.categories.some((item) => item.slug === category)) && (!type || row.file_type.endsWith(type === 'pdf' ? 'pdf' : type)));
    const count = filtered.length;
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('page_size') || 20);
    filtered = filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count, next: pageNumber * pageSize < count ? `?page=${pageNumber + 1}` : null, previous: pageNumber > 1 ? `?page=${pageNumber - 1}` : null, results: filtered }),
    });
  });
  await page.route('**/api/documents/*/file/**', async (route) => {
    const url = new URL(route.request().url());
    fileCalls.push(url.pathname + url.search);
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const row = rows.find((item) => item.id === id);
    if (!row || row.require_login_to_download) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Sign in is required.' }) });
      return;
    }
    const fixturePath = path.join(fixtures, site.code === 'MAIN' ? 'main-university' : 'informatics-college', row.qaFixture);
    await route.fulfill({
      status: 200,
      contentType: row.file_type,
      headers: { 'content-disposition': url.searchParams.has('inline') ? 'inline' : `attachment; filename="${row.qaFixture}"` },
      path: fixturePath,
    });
  });

  try {
    const response = await page.goto(`http://${site.host}/documents`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert(response && response.status() < 400, `${site.host} /documents failed: ${response?.status()}`);
    await page.locator('[data-public-site]').waitFor();
    assert.equal(await page.locator('[data-public-site]').getAttribute('data-site-code'), site.code);
    await page.getByRole('heading', { name: 'Documents & Files', exact: true }).waitFor();
    await page.getByRole('heading', { name: rows[0].title, exact: true }).waitFor();
    assert.equal(await page.locator('[data-document-card="true"]').count(), 20, 'first page contains 20 current-Site documents');
    assert.equal(await page.getByRole('heading', { name: rows.find((row) => row.id.startsWith(site.id === 2 ? '3-' : '2-'))?.title || 'impossible' }).count(), 0, 'other Site title must not be rendered');

    const firstCard = page.locator('[data-document-card="true"]').first();
    await firstCard.hover();
    await page.waitForFunction((element) => element.getAttribute('data-details-open') === 'true', await firstCard.elementHandle());
    await page.locator('[data-document-card="true"]').nth(1).getByRole('button', { name: 'Details' }).focus();
    assert.equal(await page.locator('[data-document-card="true"]').nth(1).getByRole('button', { name: 'Details' }).getAttribute('aria-expanded'), 'true');
    results.push({ site: site.code, test: 'current-Site listing and hover/focus details', status: 'PASS' });

    const loginRow = rows.find((row) => row.require_login_to_download);
    const loginCard = page.locator(`[data-document-card="true"]`).filter({ has: page.getByRole('heading', { name: loginRow.title, exact: true }) });
    const loginLink = loginCard.locator('a').first();
    const loginLinkLabel = await loginLink.getAttribute('aria-label');
    assert.match(loginLinkLabel || '', /sign in required/i, `screen-reader label should announce login requirement; got ${loginLinkLabel}`);
    await loginLink.click();
    await loginCard.getByRole('alert').waitFor();
    await loginCard.getByRole('link', { name: 'Sign in', exact: true }).waitFor();

    const pdfCard = page.locator('[data-document-card="true"]').filter({ has: page.getByRole('heading', { name: rows[0].title, exact: true }) });
    const [pdfTab] = await Promise.all([page.waitForEvent('popup'), pdfCard.getByRole('link', { name: `View PDF: ${rows[0].title}`, exact: true }).click()]);
    await pdfTab.waitForURL((url) => url.protocol === 'blob:', { timeout: 15000 });
    assert((pdfTab.url()).startsWith('blob:'), 'PDF opens an authorized blob URL in a separate tab');
    await pdfTab.close();
    await page.evaluate(() => {
      window.__qaDownloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__qaDownloads.push({ href: this.href, download: this.download, connected: this.isConnected, active: navigator.userActivation?.isActive });
        return click.call(this);
      };
    });
    for (const row of rows.filter((item) => !item.id.includes('archive') && ['docx', 'xlsx', 'zip'].includes(item.file_type === mime.docx ? 'docx' : item.file_type === mime.xlsx ? 'xlsx' : item.file_type === mime.zip ? 'zip' : 'pdf'))) {
      const card = page.locator('[data-document-card="true"]').filter({ has: page.getByRole('heading', { name: row.title, exact: true }) });
      const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('link', { name: new RegExp(`Download ${row.file_type === mime.docx ? 'DOCX' : row.file_type === mime.xlsx ? 'XLSX' : 'ZIP'}`) }).click()]);
      assert.equal(download.suggestedFilename(), row.qaFixture);
    }
    results.push({ site: site.code, test: 'login-required handling, PDF view, DOCX/XLSX/ZIP downloads', status: 'PASS' });

    await page.getByRole('textbox', { name: 'Search documents' }).fill(rows[2].title);
    await page.getByRole('button', { name: 'Apply' }).click();
    await waitForCall(calls, (entry) => entry.includes('search='), 'search request');
    await page.getByRole('heading', { name: rows[2].title, exact: true }).waitFor();
    assert(calls.some((entry) => entry.includes('search=')), 'search query reached listing API');
    await page.goto(`http://${site.host}/documents`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: rows[0].title, exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Policies' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await waitForCall(calls, (entry) => entry.includes('category=policies'), 'category request');
    await page.getByRole('heading', { name: rows[0].title, exact: true }).waitFor();
    assert(calls.some((entry) => entry.includes('category=policies')), 'category filter reached listing API');
    await page.goto(`http://${site.host}/documents`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: rows[0].title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next page' }).click();
    await waitForCall(calls, (entry) => entry.includes('page=2'), 'second page request');
    await page.getByText('Page 2 · 25 documents').waitFor();
    assert(calls.some((entry) => entry.includes('page=2')), 'page request reached listing API');
    results.push({ site: site.code, test: 'search, category filters, and pagination', status: 'PASS' });

    const axePath = require.resolve('axe-core/axe.min.js', { paths: [process.env.UOG_QA_TOOLS] });
    const axeResults = [];
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://${site.host}/documents`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: rows[0].title, exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}px`);
      await page.addScriptTag({ path: axePath });
      const scan = await page.evaluate(async () => {
        const report = await axe.run({ exclude: [['nextjs-portal']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return { violations: report.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => ({ target: node.target, html: node.html, summary: node.failureSummary, checks: [...node.any, ...node.all].map((check) => ({ id: check.id, data: check.data })) })) })), passes: report.passes.length, incomplete: report.incomplete.map((item) => item.id) };
      });
      axeResults.push({ width, ...scan });
      await page.screenshot({ path: path.join(evidence, `${site.code.toLowerCase()}-documents-${width}.png`), fullPage: true });
      assert.equal(scan.violations.length, 0, `axe violations at ${width}px: ${JSON.stringify(scan.violations)}`);
    }
    results.push({ site: site.code, test: 'responsive layout and axe WCAG 2.1 A/AA automated subset', status: 'PASS', widths: [1440, 768, 390], axe: axeResults });
  } catch (error) {
    results.push({ site: site.code, test: 'browser E2E', status: 'FAIL', error: String(error?.message || error).slice(0, 6000), currentUrl: page.url(), body: (await page.locator('body').innerText().catch(() => '')).slice(0, 1200), downloadDebug: await page.evaluate(() => window.__qaDownloads || []).catch(() => []), calls, fileCalls });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.UOG_QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'],
  });
  try {
    for (const site of siteTargets) await verifySite(browser, site);
    fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ run: 'P4-DOC-009', date: new Date().toISOString(), browser: browser.version(), fixtures: 'synthetic fixture files returned by test-only API routes; Main/College site context loaded from the running application', results }, null, 2) + '\n');
    console.log(JSON.stringify({ browser: browser.version(), passed: results.filter((item) => item.status === 'PASS').length, failed: results.filter((item) => item.status === 'FAIL').length, evidence }, null, 2));
    if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(`Browser run failed: ${String(error?.message || error).slice(0, 600)}`); process.exitCode = 1; });
