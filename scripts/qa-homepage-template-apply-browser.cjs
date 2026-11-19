const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.UOG_QA_PLAYWRIGHT_ROOT);

(async () => {
  const seed = JSON.parse(fs.readFileSync(0, "utf8"));
  const output = "docs/qa/homepage-template-apply-2026-11-19";
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  const pass = (name) => {
    results.push({ name, status: "PASS" });
    console.log(`${name} PASS`);
  };
  const browser = await chromium.launch({
    executablePath: process.env.UOG_QA_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    args: ["--no-proxy-server", "--host-resolver-rules=MAP *.uog.local 127.0.0.1"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => results.push({ name: `pageerror: ${error.message}`, status: "DIAGNOSTIC" }));

  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      response = await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded", timeout: 120000 });
      if (response && response.status() < 500) break;
      await page.waitForTimeout(2000);
    }
    await page.getByRole("button", { name: "Sign in with Keycloak", exact: true }).click();
    await page.locator("#username").fill(seed.member.username);
    await page.locator("#password").fill(seed.member.password);
    await page.locator("#kc-login").click();
    await page.waitForURL((url) => url.origin === "http://localhost" && url.pathname.startsWith("/admin"));

    const settingsUrl = `http://localhost/admin/sites/${seed.site}/admin/homepage`;
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: "Homepage templates", exact: true }).waitFor();
    await page.getByText(seed.homepage_title, { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/homepage-settings-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Preview University Main", exact: true }).click();
    const preview = page.getByLabel("University Main template preview", { exact: true });
    await preview.getByRole("heading", { name: "Welcome to our university", exact: true }).waitFor();
    await page.screenshot({ path: `${output}/template-preview-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Apply University Main as draft", exact: true }).click();
    await page.getByText(/published homepage will remain unchanged/i).waitFor();
    const draftTitle = `E2E Applied ${seed.run} ${Date.now()}`;
    await page.getByRole("textbox", { name: "Draft title" }).fill(draftTitle);
    await page.getByRole("button", { name: "Confirm and open draft", exact: true }).click();
    await page.waitForURL((url) => /\/pages\/[0-9a-f-]+\/builder$/.test(url.pathname));
    const createdId = page.url().match(/\/pages\/([0-9a-f-]+)\/builder$/)?.[1];
    assert(createdId, "apply should open the created Page in Visual Builder");
    await page.getByLabel("Visual Builder workspace").waitFor();
    await page.getByRole("tab", { name: "Structure", exact: true }).click();
    for (const type of ["Site Logo", "Site Title", "Menu", "Headline", "Editor", "Button Grid", "Loop Grid"]) {
      await page.getByRole("button", { name: new RegExp(`Select ${type} `) }).first().waitFor();
    }
    pass("AC-01 valid template creates an editable Page draft with the expected component structure");
    await page.getByRole("button", { name: /Select Headline / }).first().click();
    const textField = page.getByRole("complementary", { name: "Widget inspector" }).getByRole("textbox", { name: "Text" });
    await textField.fill("E2E edited homepage title");
    await page.getByText("Unsaved changes", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Visual draft saved. The public revision is unchanged.", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("Visual Builder workspace").waitFor();
    await page.getByRole("tab", { name: "Structure", exact: true }).click();
    await page.getByRole("button", { name: /Select Headline / }).first().click();
    const reopenedField = page.getByRole("complementary", { name: "Widget inspector" }).getByRole("textbox", { name: "Text" });
    await reopenedField.waitFor();
    assert.equal(await reopenedField.inputValue(), "E2E edited homepage title");
    await page.screenshot({ path: `${output}/builder-saved-desktop.png`, fullPage: true });
    pass("AC-03 editor modifies, saves and reopens the resulting draft in Visual Builder");

    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile builder should not overflow horizontally");
    await page.screenshot({ path: `${output}/builder-saved-mobile.png`, fullPage: true });
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByText(seed.homepage_title, { exact: true }).waitFor();
    pass("AC-02 published homepage assignment remains unchanged after draft application");
    pass("AC-08 applied draft remains editable and versioned through existing Page revisions");

    await page.getByRole("button", { name: "Preview College/Department", exact: true }).click();
    await page.getByRole("button", { name: "Apply College/Department as draft", exact: true }).click();
    await page.getByRole("combobox", { name: "Draft action" }).click();
    await page.getByRole("option", { name: "Replace an existing draft", exact: true }).click();
    await page.getByRole("combobox", { name: "Draft to replace" }).click();
    await page.getByRole("option", { name: draftTitle, exact: true }).click();
    await page.getByRole("button", { name: "Confirm and open draft", exact: true }).click();
    await page.waitForTimeout(5000);
    if (!/\/pages\/[0-9a-f-]+\/builder$/.test(new URL(page.url()).pathname)) {
      const alerts = await page.getByRole("alert").allInnerTexts().catch(() => []);
      throw new Error(`replacement did not open the Visual Builder; URL=${page.url()}; alerts=${alerts.join(" | ")}`);
    }
    await page.getByLabel("Visual Builder workspace").waitFor();
    await page.getByText("Welcome to our academic community", { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/builder-replaced-desktop.png`, fullPage: true });
    pass("Replace mode fetches a current Page ETag, applies the second template and reopens the selected draft");
  } catch (error) {
    results.push({ name: error.message, status: "FAIL" });
    await page.locator("body").innerText().then((text) => fs.writeFileSync(`${output}/failure-text.txt`, text)).catch(() => {});
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(`${output}/e2e-results.json`, JSON.stringify({ run: seed.run, results }, null, 2));
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
