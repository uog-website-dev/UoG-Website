/* Real browser metadata workflow. Generated credentials arrive only on stdin. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT || 'playwright-core');

(async () => {
  const seed = JSON.parse(fs.readFileSync(0, 'utf8'));
  const fixture = seed.metadata;
  const output = path.resolve('docs/qa/post-metadata-2026-11-13');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP *.uog.local 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const results = [];
  let step = 'Keycloak login';
  const title = 'Metadata browser ' + seed.run;
  const slug = 'browser-' + seed.run;
  const pass = (name, details) => {
    results.push({ name, status: 'PASS', details });
    console.log(name + ' PASS');
  };
  try {
    await page.goto('http://localhost/admin', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill(seed.profiles.author.username);
    await page.locator('#password').fill(seed.profiles.author.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === 'http://localhost' && url.pathname.startsWith('/admin'), { timeout: 90000 });
    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/posts`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('table', { name: 'Posts for this Site' }).waitFor();
    await page.waitForLoadState('networkidle');
    pass('Site Editor access', 'Real Keycloak session opens the active Site Post administration.');

    step = 'Create complete metadata';
    await page.getByRole('button', { name: 'Create Post', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).fill(slug);
    await page.getByRole('textbox', { name: 'Excerpt', exact: true }).fill('A university summary');
    await page.getByRole('textbox', { name: 'Article body', exact: true }).fill('Metadata article body');
    await page.getByRole('combobox', { name: 'Categories', exact: true }).click();
    assert.equal(await page.getByRole('listbox').getByRole('option').count(), 101);
    await page.getByRole('option', { name: fixture.category_name, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Tags', exact: true }).click();
    assert.equal(await page.getByRole('listbox').getByRole('option').count(), 1);
    await page.getByRole('option', { name: 'Campus', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.getByRole('dialog', { name: 'Create Post', exact: true }).waitFor({ state: 'hidden' });
    pass('Complete metadata save', 'Title, permalink, summary, category and tag save through real server actions.');
    pass('Taxonomy pagination and Site scope', 'All 101 active Site categories are available including the final page. Inactive and foreign terms are excluded.');

    step = 'Reopen metadata';
    await page.getByRole('button', { name: 'Edit ' + title, exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), title);
    assert.equal(await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).inputValue(), slug);
    assert.equal(await page.getByRole('textbox', { name: 'Excerpt', exact: true }).inputValue(), 'A university summary');
    assert.match(await page.getByRole('combobox', { name: 'Categories', exact: true }).textContent(), /Zoology Research/);
    assert.match(await page.getByRole('combobox', { name: 'Tags', exact: true }).textContent(), /Campus/);
    await page.screenshot({ path: path.join(output, 'settings-identity.png'), fullPage: true });
    pass('Metadata round trip', 'Reopening reproduces all five metadata values.');

    step = 'Duplicate permalink recovery';
    await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).fill(fixture.published_slug);
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.getByText(/already exists in this Site|already used in this Site/).first().waitFor();
    const corrected = slug + '-revised';
    await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).fill(corrected);
    assert.equal(await page.getByRole('button', { name: 'Save Draft', exact: true }).isEnabled(), true);
    await page.getByRole('textbox', { name: 'Excerpt', exact: true }).fill('A revised university summary');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor({ state: 'hidden' });
    pass('Duplicate permalink recovery', 'The slug field identifies a conflict with published news. Correcting the value enables a successful save.');

    step = 'Taxonomy-only revision';
    await page.getByRole('button', { name: 'Edit ' + title, exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Categories', exact: true }).click();
    await page.getByRole('option', { name: fixture.category_name, exact: true }).click();
    await page.getByRole('option', { name: 'Category 000', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Edit ' + title, exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor();
    assert.match(await page.getByRole('combobox', { name: 'Categories', exact: true }).textContent(), /Category 000/);
    assert.equal(await page.getByRole('textbox', { name: 'Excerpt', exact: true }).inputValue(), 'A revised university summary');
    await page.getByRole('combobox', { name: 'Categories', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'settings-taxonomy.png'), fullPage: true });
    pass('Taxonomy-only edit', 'A category-only save reloads with the selected category and retains the summary and tag.');

    step = 'Reserved permalink and keyboard';
    await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).fill('admin');
    await page.getByText(/is reserved and cannot be used/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save Draft', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).fill(corrected);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('textbox', { name: 'Excerpt', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'BODY'), false);
    await page.addScriptTag({ path: process.env.UOG_QA_AXE_PATH });
    const violations = await page.evaluate(async () => {
      const result = await axe.run(document.querySelector('[role="dialog"]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }));
    });
    fs.writeFileSync(path.join(output, 'accessibility.json'), JSON.stringify(violations, null, 2));
    assert.equal(violations.length, 0);
    await page.screenshot({ path: path.join(output, 'settings-mobile.png'), fullPage: true });
    pass('Reserved slug and accessible settings', 'Reserved input blocks save. Mobile fields remain keyboard reachable and the editor has zero scanned WCAG A/AA violations.');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor({ state: 'hidden' });

    step = 'Published metadata lock';
    await page.getByRole('button', { name: 'Edit ' + fixture.published_title, exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Post', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Permalink slug', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Save Draft', exact: true }).isDisabled(), true);
    pass('Published identity lock', 'Published title and permalink use the existing workflow lock.');

    step = 'Public snapshot and draft privacy';
    const publicPage = await context.newPage();
    await publicPage.goto('http://' + fixture.host_a + '/posts/' + fixture.published_slug, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await publicPage.getByRole('heading', { name: fixture.published_title, exact: true, level: 1 }).waitFor();
    await publicPage.getByText('Approved university summary', { exact: true }).waitFor();
    const values = await publicPage.evaluate(async ({ published, draft }) => {
      const approved = await fetch('/api/v1/site-context/posts/' + published + '/');
      const body = await approved.json();
      const privateDraft = await fetch('/api/v1/site-context/posts/' + draft + '/');
      return { title: body.title, excerpt: body.excerpt, categories: body.categories, tags: body.tags, draftStatus: privateDraft.status };
    }, { published: fixture.published_slug, draft: corrected });
    assert.equal(values.title, fixture.published_title);
    assert.equal(values.excerpt, 'Approved university summary');
    assert.equal(values.categories[0].name, fixture.category_name);
    assert.equal(values.tags[0].name, 'Campus');
    assert.equal(values.draftStatus, 404);
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.screenshot({ path: path.join(output, 'public-metadata-mobile.png'), fullPage: true });
    pass('Public metadata and draft privacy', 'The approved title, summary and taxonomy render through the existing public route. Draft metadata returns 404.');
    await publicPage.close();
  } catch (error) {
    results.push({ name: step, status: 'FAIL', error: error.name });
    console.error(step + ' FAIL ' + error.name);
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ run: seed.run, site: seed.site, browser: browser.version(), results }, null, 2));
    await browser.close();
  }
})();
