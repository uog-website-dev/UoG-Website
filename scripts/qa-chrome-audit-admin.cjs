/**
 * Admin login + axe for P4-F-CHROME audit. Read-only; no credentials in evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("./perf/node_modules/playwright-core");

const OUT = path.resolve("docs/qa/chrome-audit-2026-11-26");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const AXE = ".git/task-data/release-tools/node_modules/axe-core/axe.min.js";

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function runAxe(page) {
  await page.addScriptTag({ path: path.resolve(AXE) });
  return page.evaluate(async () => {
    const r = await axe.run(
      { exclude: [["nextjs-portal"]] },
      { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } },
    );
    return {
      violationCount: r.violations.length,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
      passes: r.passes.length,
    };
  });
}

(async () => {
  const env = loadEnv();
  const user = env.KEYCLOAK_DEV_USERNAME || "devuser";
  const pass = env.KEYCLOAK_DEV_PASSWORD || "";
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-proxy-server"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);

  const loginLog = [];
  await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  loginLog.push({ step: "land", url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 200) });

  // Click Sign in if present on gate page
  const signIn = page.getByRole("button", { name: /Sign in/i }).or(page.getByRole("link", { name: /Sign in/i }));
  if (await signIn.count()) {
    await signIn.first().click();
    await page.waitForTimeout(2500);
    loginLog.push({ step: "after-sign-in-click", url: page.url(), title: await page.title() });
  }

  // Keycloak form
  for (let i = 0; i < 3; i++) {
    if (/login|auth|realms/i.test(page.url()) || (await page.locator("#username, input[name='username']").count())) break;
    await page.waitForTimeout(1500);
  }
  loginLog.push({ step: "pre-fill", url: page.url(), hasUser: await page.locator("#username, input[name='username']").count() });

  if (await page.locator("#username, input[name='username']").count()) {
    await page.locator("#username, input[name='username']").first().fill(user);
    await page.locator("#password, input[name='password']").first().fill(pass);
    await page.locator("#kc-login, button[type='submit']").first().click();
    await page.waitForTimeout(5000);
  }
  loginLog.push({ step: "post-submit", url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 240) });
  await page.screenshot({ path: path.join(OUT, "admin-login-state.png"), fullPage: false });

  // If still gated, try /admin/api/auth/signin or next-auth style
  if (/Sign in to continue/i.test(await page.locator("body").innerText())) {
    const providers = page.locator("a, button").filter({ hasText: /Sign in|Keycloak|Continue/i });
    const count = await providers.count();
    loginLog.push({ step: "providers", count });
    if (count) {
      await providers.first().click();
      await page.waitForTimeout(3000);
      if (await page.locator("#username").count()) {
        await page.fill("#username", user);
        await page.fill("#password", pass);
        await page.click("#kc-login");
        await page.waitForTimeout(5000);
      }
      loginLog.push({ step: "provider-retry", url: page.url(), text: (await page.locator("body").innerText()).slice(0, 240) });
    }
  }

  fs.writeFileSync(path.join(OUT, "admin-login-log.json"), JSON.stringify(loginLog, null, 2));

  const authed = /devuser|Sign out|Dashboard|workspace/i.test(await page.locator("body").innerText()) && !/Sign in to continue/i.test(await page.locator("body").innerText());
  const admin = [];
  if (!authed) {
    fs.writeFileSync(path.join(OUT, "admin.json"), JSON.stringify([{ name: "login-failed", loginLog }], null, 2));
    console.log(JSON.stringify({ authed: false, loginLog }, null, 2));
    await browser.close();
    return;
  }

  const routes = [
    { name: "workspace", path: "/admin/" },
    { name: "site-dashboard", path: "/admin/sites/102/admin/" },
    { name: "appearance", path: "/admin/sites/102/admin/appearance" },
    { name: "header", path: "/admin/sites/102/admin/header" },
    { name: "footer", path: "/admin/sites/102/admin/footer" },
    { name: "menus", path: "/admin/sites/102/admin/menus" },
    { name: "pages", path: "/admin/sites/102/admin/pages" },
    { name: "posts", path: "/admin/sites/102/admin/posts" },
    { name: "builder-home", path: "/admin/sites/102/admin/pages/180d0b82-420d-4d86-838d-d6fb33423029/builder" },
  ];

  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const started = Date.now();
    const res = await page.goto(`http://localhost${route.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2800);
    const meta = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim()).filter(Boolean),
      bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
    }));
    const axe = await runAxe(page);
    await page.screenshot({ path: path.join(OUT, `admin-${route.name}-1440.png`), fullPage: false });
    admin.push({ name: route.name, route: route.path, status: res?.status() || 0, readyMs: Date.now() - started, ...meta, axe });
  }

  // Mobile drawer keyboard
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const open = page.getByRole("button", { name: /Open navigation menu/i }).first();
  let mobile = { opened: false };
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(500);
    mobile = {
      opened: true,
      initialFocus: await page.evaluate(() => ({
        ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
        text: (document.activeElement?.textContent || "").trim().slice(0, 40),
      })),
      drawerAttrs: await page.evaluate(() => {
        const d = document.querySelector(".MuiDrawer-root, [role='dialog'], nav");
        return { role: d?.getAttribute("role") || "", label: d?.getAttribute("aria-label") || "", tag: d?.tagName || "" };
      }),
    };
    await page.screenshot({ path: path.join(OUT, "admin-mobile-nav-open.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    mobile.restoredTo = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || "");
  }
  fs.writeFileSync(path.join(OUT, "admin-mobile-keyboard.json"), JSON.stringify(mobile, null, 2));
  fs.writeFileSync(path.join(OUT, "admin.json"), JSON.stringify(admin, null, 2));

  console.log(JSON.stringify({
    authed: true,
    screens: admin.length,
    violations: admin.reduce((n, s) => n + s.axe.violationCount, 0),
    summary: admin.map((s) => ({ name: s.name, h1: s.h1, viol: s.axe.violationCount, ids: s.axe.violations.map((v) => v.id) })),
    mobile,
  }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
