/* Authenticated browser demonstration of Site-scoped document lifecycle. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.UOG_QA_TOOLS, 'node_modules', 'playwright-core'));

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs', 'qa', 'P4-DOC-009', 'evidence');
const fixtures = path.join(root, 'docs', 'qa', 'P4-DOC-009', 'fixtures');
const targets = [
  { id: 2, code: 'MAIN', host: 'www.uog.local', label: 'Main University', fixture: path.join(fixtures, 'main-university', 'policy.pdf') },
  { id: 3, code: 'INFORMATICS', host: 'informatics.uog.local', label: 'Informatics College', fixture: path.join(fixtures, 'informatics-college', 'college-regulations.pdf') },
];
function loadEnv() {
  const values = {};
  for (const envFile of ['.env.example', '.env']) {
    const filename = path.join(root, envFile);
    if (!fs.existsSync(filename)) continue;
    for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  }
  return values;
}
const env = loadEnv();
const run = `p4doc-${crypto.randomBytes(4).toString('hex')}`;
const qaPassword = `Qa!${crypto.randomBytes(16).toString('base64url')}9x`;
const results = [];
let browserVersion = 'pending';
function writeResults() {
  fs.writeFileSync(path.join(evidence, 'admin-workflow-results.json'), JSON.stringify({ run, date: new Date().toISOString(), browser: browserVersion, sites: targets.map(({ id, code }) => ({ id, code })), results }, null, 2) + '\n');
}
const record = (site, step, status, detail = '') => {
  results.push({ site, step, status, ...(detail ? { detail } : {}) });
  writeResults();
  console.log(`${site}: ${step} ${status}`);
};

async function login(page, username, secret) {
  await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const signIn = page.getByRole('button', { name: /Continue to sign in|Sign in/i }).or(page.getByRole('link', { name: /Continue to sign in|Sign in/i }));
  if (await signIn.count()) {
    await signIn.first().click();
  }
  await page.locator('#username').waitFor({ timeout: 30000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(secret);
  await page.locator('#kc-login').click();
  if (await page.locator('#firstName').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
    await page.locator('#firstName').fill('QA');
    await page.locator('#lastName').fill('Documents');
    await page.locator('button[type="submit"],input[type="submit"]').click();
  }
  await page.waitForURL((url) => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 90000 });
}

async function provisionSiteAdmin(browser, site) {
  const username = `${run}-${site.code.toLowerCase()}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await login(page, env.KEYCLOAK_DEV_USERNAME || 'devuser', env.KEYCLOAK_DEV_PASSWORD || '');
  await page.goto(`http://localhost/admin/sites/${site.id}/admin/users`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create user', exact: true });
  await dialog.getByRole('textbox', { name: /^Username/ }).fill(username);
  await dialog.getByRole('textbox', { name: /^Email/ }).fill(`${username}@example.invalid`);
  await dialog.getByLabel(/^Password/).fill(qaPassword);
  await dialog.getByLabel(/^Confirm password/).fill(qaPassword);
  await dialog.getByRole('combobox', { name: /Site role/ }).click();
  assert.equal(await page.getByRole('option', { name: 'Platform Administrator', exact: true }).count(), 0, 'Site role picker must not expose Platform Administrator');
  await page.getByRole('option', { name: 'Site Administrator', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.waitForTimeout(3000);
  if (await dialog.isVisible()) {
    // A backend 201 may have committed while the current development build's
    // server-action form stays busy; reload the authorized directory and
    // verify the resulting assignment before continuing the E2E.
    await page.goto(`http://localhost/admin/sites/${site.id}/admin/users`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await page.getByRole('row').filter({ hasText: username }).getByText('Site Administrator').waitFor();
  await context.close();
  record(site.code, 'create separate Site Administrator through UI', 'PASS');
  return { username, password: qaPassword };
}

async function exerciseSite(browser, site, credentials) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  try {
    await login(page, credentials.username, credentials.password);
    const docsUrl = `http://localhost/admin/sites/${site.id}/admin/documents`;
    await page.goto(docsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
    const title = `${site.label} QA published regulations ${run}`;

    await page.getByRole('button', { name: 'Add New Document', exact: true }).click();
    await page.getByRole('button', { name: 'Add New Category', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add document category', exact: true }).getByLabel('Name').fill(`${site.code} ${run}`);
    await page.getByRole('dialog', { name: 'Add document category', exact: true }).getByLabel('Slug').fill(`${site.code.toLowerCase()}-${run}`);
    await page.getByRole('dialog', { name: 'Add document category', exact: true }).getByLabel('Description').fill(`Synthetic release acceptance category for ${site.label}.`);
    await page.getByRole('dialog', { name: 'Add document category', exact: true }).getByRole('button', { name: 'Save category', exact: true }).click();

    await page.getByRole('textbox', { name: 'Document Title' }).fill(title);
    await page.getByRole('button', { name: 'Choose or upload a document', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Select document file', exact: true });
    await picker.getByRole('button', { name: 'Upload files', exact: true }).waitFor();
    await picker.locator('input[aria-label="Upload media file"]').setInputFiles(site.fixture);
    await picker.getByRole('textbox', { name: `Media name for ${path.basename(site.fixture)}` }).fill(`${site.label} QA document ${run}`);
    await picker.getByRole('textbox', { name: `Categories for ${path.basename(site.fixture)}` }).fill('P4 DOC 009, QA fixture');
    await picker.getByRole('button', { name: 'Upload 1 file', exact: true }).click();
    const uploadedItem = picker.getByRole('list', { name: 'Site media assets' }).getByRole('listitem').filter({ hasText: `${site.label} QA document ${run}` });
    await uploadedItem.getByRole('button', { name: `Select ${path.basename(site.fixture)}`, exact: true }).waitFor({ timeout: 90000 });
    await uploadedItem.getByRole('button', { name: `Select ${path.basename(site.fixture)}`, exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'Document Description' }).fill(`Synthetic public document fixture for the ${site.label} release workflow.`);
    await page.getByRole('combobox', { name: 'Categories' }).click();
    await page.getByRole('option', { name: `${site.code} ${run}`, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('checkbox', { name: 'Visible to Public', exact: true }).check();
    await page.getByLabel('Version').fill('2026-QA');
    await page.getByLabel('Effective Date').fill('2026-11-27');
    await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
    const row = page.getByRole('row').filter({ hasText: title });
    await row.waitFor();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await row.getByText('PUBLISHED', { exact: true }).waitFor({ timeout: 30000 });
    record(site.code, 'category, upload, metadata, draft, publish', 'PASS');
    await page.screenshot({ path: path.join(evidence, `${site.code.toLowerCase()}-admin-published.png`), fullPage: true });

    const publicPage = await context.newPage();
    await publicPage.goto(`http://${site.host}/documents`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await publicPage.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 30000 });
    record(site.code, 'published record appears on its Site public directory', 'PASS');
    await publicPage.screenshot({ path: path.join(evidence, `${site.code.toLowerCase()}-public-live-document.png`), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const updatedRow = page.getByRole('row').filter({ hasText: title });
    await updatedRow.getByRole('button', { name: 'Edit', exact: true }).click();
    const updatedTitle = `${title} edited`;
    await page.getByRole('textbox', { name: 'Document Title' }).fill(updatedTitle);
    await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
    const finalRow = page.getByRole('row').filter({ hasText: updatedTitle });
    await finalRow.waitFor();
    if (await finalRow.getByText('PUBLISHED', { exact: true }).count()) {
      await finalRow.getByRole('button', { name: 'Unpublish', exact: true }).click();
      await finalRow.getByText('UNPUBLISHED', { exact: true }).waitFor({ timeout: 30000 });
    }
    const unpublishedRow = page.getByRole('row').filter({ hasText: updatedTitle });
    await finalRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await unpublishedRow.getByText('PUBLISHED', { exact: true }).waitFor({ timeout: 30000 });
    await unpublishedRow.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await unpublishedRow.getByText('UNPUBLISHED', { exact: true }).waitFor({ timeout: 30000 });
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByRole('heading', { name: updatedTitle, exact: true }).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    assert.equal(await publicPage.getByRole('heading', { name: updatedTitle, exact: true }).count(), 0, 'unpublished QA document must disappear from the public directory');
    record(site.code, 'edit, republish, unpublish revocation', 'PASS');
    await page.screenshot({ path: path.join(evidence, `${site.code.toLowerCase()}-admin-unpublished.png`), fullPage: true });
  } catch (error) {
    record(site.code, 'authenticated admin workflow', 'FAIL', String(error?.message || error).slice(0, 500));
    await page.screenshot({ path: path.join(evidence, `${site.code.toLowerCase()}-admin-failure.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function cleanupSiteAdmin(browser, site, username) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  try {
    await login(page, env.KEYCLOAK_DEV_USERNAME || 'devuser', env.KEYCLOAK_DEV_PASSWORD || '');
    await page.goto(`http://localhost/admin/sites/${site.id}/admin/users`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const remove = page.getByRole('button', { name: `Remove Site Administrator from ${username}`, exact: true });
    if (await remove.count()) {
      await remove.click();
      const dialog = page.getByRole('dialog', { name: 'Remove Site role?', exact: true });
      await dialog.getByRole('button', { name: 'Remove role', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    record(site.code, 'remove temporary Site Administrator membership', 'PASS');
  } catch (error) {
    record(site.code, 'remove temporary Site Administrator membership', 'FAIL', String(error?.message || error).slice(0, 300));
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.UOG_QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'],
  });
  browserVersion = browser.version();
  writeResults();
  try {
    for (const site of targets) {
      const credentials = await provisionSiteAdmin(browser, site);
      try { await exerciseSite(browser, site, credentials); }
      finally { await cleanupSiteAdmin(browser, site, credentials.username); }
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`Admin workflow stopped: ${String(error?.message || error).slice(0, 500)}`);
  } finally {
    writeResults();
    await browser.close();
  }
})().catch((error) => { console.error(`Admin E2E failed: ${String(error?.message || error).slice(0, 500)}`); process.exitCode = 1; });
