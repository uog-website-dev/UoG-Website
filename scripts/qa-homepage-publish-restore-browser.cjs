const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);

(async () => {
  const seed = JSON.parse(fs.readFileSync(0, "utf8"));
  const output = "docs/qa/homepage-publish-restore-2026-11-19";
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  const pass = (name) => { results.push({ name, status: "PASS" }); console.log(`${name} PASS`); };
  const browser = await chromium.launch({ executablePath: process.env.UOG_QA_BROWSER, headless: true, args: ["--no-proxy-server", "--host-resolver-rules=MAP *.uog.local 127.0.0.1"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      response = await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded", timeout: 120000 });
      if (response && response.status() < 500) break;
      await page.waitForTimeout(2000);
    }
    await page.getByRole("button", { name: "Sign in with Keycloak", exact: true }).click();
    await page.locator("#username").fill(seed.username);
    await page.locator("#password").fill(seed.password);
    await page.locator("#kc-login").click();
    await page.waitForURL((url) => url.origin === "http://localhost" && url.pathname.startsWith("/admin"));

    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/homepage`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByText(seed.liveTitle, { exact: true }).waitFor();
    await page.getByText(seed.pendingTitle, { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/homepage-pending-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile Homepage Settings must not overflow");
    await page.screenshot({ path: `${output}/homepage-pending-mobile.png`, fullPage: true });
    pass("Homepage Settings shows the effective published root and its private template draft");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/pages`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const revisionsButton = page.getByRole("button", { name: `Revisions for ${seed.pendingTitle}`, exact: true });
    await revisionsButton.waitFor();
    await revisionsButton.click();
    await page.getByRole("dialog", { name: `Revisions: ${seed.pendingTitle}` }).waitFor();
    const restoreButton = page.getByRole("button", { name: "Restore as draft", exact: true }).first();
    await restoreButton.waitFor();
    await restoreButton.click();
    await page.getByRole("dialog", { name: "Restore Page revision?" }).waitFor();
    await page.getByRole("button", { name: "Confirm restore", exact: true }).click();
    await page.getByText(/Revision \d+ restored as a new draft\./).waitFor();
    await page.screenshot({ path: `${output}/revision-restored-desktop.png`, fullPage: true });
    pass("An authorized editor restores an older Page revision as a new editable draft");

    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/homepage`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByText(seed.liveTitle, { exact: true }).waitFor();
    pass("Restoring the draft leaves the current live homepage assignment unchanged");

    const readRoot = async (host) => {
      const response = await page.request.get("http://localhost:8000/api/v1/site-context/homepage/", { headers: { Host: host }, timeout: 30000 });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      if (body && typeof body === "object") delete body.request_id;
      return { status: response.status(), body };
    };
    const siteBRootBefore = await readRoot(seed.siteBHost);
    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/pages`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("button", { name: `Publish ${seed.publishTitle}`, exact: true }).click();
    await page.getByRole("dialog", { name: `Publish Page?` }).waitFor();
    await page.getByRole("button", { name: "Confirm publish", exact: true }).click();
    const setHomepage = page.getByRole("button", { name: `Set ${seed.publishTitle} as homepage`, exact: true });
    await setHomepage.waitFor();
    await setHomepage.click();
    await page.getByText(`Homepage assigned: ${seed.publishTitle}`, { exact: true }).waitFor();
    const siteARoot = await readRoot(seed.siteHost);
    assert.equal(siteARoot.status, 200, "Site A public root should resolve after publish and assignment");
    assert(JSON.stringify(siteARoot.body).includes(seed.publishTitle), "Site A root should serve the newly published and assigned Page");
    const siteBRootAfter = await readRoot(seed.siteBHost);
    assert.deepEqual(siteBRootAfter, siteBRootBefore, "publishing and assigning Site A must not affect Site B's public root");
    pass("Publishing and assigning Site A updates only its public root; Site B is unchanged");

    await page.goto(`http://localhost/admin/sites/${seed.site}/admin/homepage`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("combobox", { name: "Eligible Page" }).click();
    await page.getByRole("option", { name: new RegExp(seed.liveTitle) }).click();
    await page.getByRole("button", { name: "Assign homepage", exact: true }).click();
    await page.getByText(`Homepage assigned: ${seed.liveTitle}`, { exact: true }).waitFor();

    const publicPage = await page.request.get("http://localhost:8000/api/v1/site-context/homepage/", { headers: { Host: seed.siteHost }, timeout: 30000 });
    assert.equal(publicPage.status(), 200, "the anonymous public root should resolve the restored live assignment");
    const liveDocument = await publicPage.text();
    assert(liveDocument.includes(seed.liveTitle), "anonymous root should keep serving the live homepage");
    assert(!liveDocument.includes(seed.pendingTitle), "anonymous homepage must not expose the draft title");
    pass("Anonymous public root serves the restored live assignment and excludes the pending draft");
  } catch (error) {
    results.push({ name: error.message, status: "FAIL" });
    await fs.promises.writeFile(`${output}/failure-text.txt`, await page.locator("body").innerText().catch(() => ""));
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(`${output}/e2e-results.json`, JSON.stringify({ run: seed.run, results }, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
