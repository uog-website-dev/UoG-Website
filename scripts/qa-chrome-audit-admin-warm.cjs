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
    };
  });
}

async function login(page, user, pass) {
  await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  const signIn = page.getByRole("button", { name: /Continue to sign in|Sign in/i }).or(page.getByRole("link", { name: /Continue to sign in|Sign in/i }));
  if (await signIn.count()) await signIn.first().click();
  await page.waitForTimeout(2000);
  await page.locator("#username").fill(user);
  await page.locator("#password").fill(pass);
  await page.locator("#kc-login").click();
  await page.waitForTimeout(5000);
}

(async () => {
  const env = loadEnv();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-proxy-server"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await login(page, env.KEYCLOAK_DEV_USERNAME || "devuser", env.KEYCLOAK_DEV_PASSWORD || "");

  const routes = [
    { name: "workspace", path: "/admin/" },
    { name: "site-dashboard", path: "/admin/sites/17/admin/" },
    { name: "appearance", path: "/admin/sites/17/admin/appearance" },
    { name: "header", path: "/admin/sites/17/admin/header" },
    { name: "footer", path: "/admin/sites/17/admin/footer" },
    { name: "menus", path: "/admin/sites/17/admin/menus" },
    { name: "pages", path: "/admin/sites/17/admin/pages" },
    { name: "posts", path: "/admin/sites/17/admin/posts" },
    { name: "builder-aau", path: "/admin/sites/102/admin/pages/180d0b82-420d-4d86-838d-d6fb33423029/builder" },
  ];
  const out = [];
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const started = Date.now();
    await page.goto(`http://localhost${route.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    // Wait out loading shells
    await page.getByText(/Loading Site workspace|Loading navigation|Loading Visual Builder|Loading workspace/i).waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const meta = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim()).filter(Boolean),
      bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
      hasUnsupportedLayout: /unsupported or invalid layout|content is currently unavailable/i.test(document.body.innerText),
    }));
    const axe = await runAxe(page);
    await page.screenshot({ path: path.join(OUT, `admin-${route.name}-1440.png`), fullPage: false });
    if (route.name === "workspace" || route.name === "menus") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `admin-${route.name}-390.png`), fullPage: false });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    out.push({ name: route.name, route: route.path, readyMs: Date.now() - started, ...meta, axe });
  }
  fs.writeFileSync(path.join(OUT, "admin-warm.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.map((s) => ({
    name: s.name,
    h1: s.h1,
    viol: s.axe.violationCount,
    ids: s.axe.violations.map((v) => `${v.id}:${v.impact}`),
    unsupported: s.hasUnsupportedLayout,
    readyMs: s.readyMs,
  })), null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
