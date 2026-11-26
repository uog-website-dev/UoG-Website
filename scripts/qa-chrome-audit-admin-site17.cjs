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

(async () => {
  const env = loadEnv();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-proxy-server"] });
  const page = await browser.newPage();
  const net = [];
  page.on("response", async (res) => {
    const u = res.url();
    if (/\/api\/|admin\/api|sites\/17|workspace/i.test(u)) {
      net.push({ status: res.status(), url: u.slice(0, 180) });
    }
  });
  page.setDefaultTimeout(120000);
  await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const signIn = page.getByRole("button", { name: /Continue to sign in|Sign in/i }).or(page.getByRole("link", { name: /Continue to sign in|Sign in/i }));
  if (await signIn.count()) await signIn.first().click();
  await page.waitForTimeout(2000);
  await page.fill("#username", env.KEYCLOAK_DEV_USERNAME || "devuser");
  await page.fill("#password", env.KEYCLOAK_DEV_PASSWORD || "");
  await page.click("#kc-login");
  await page.waitForTimeout(5000);

  // Warm platform workspace first
  await page.goto("http://localhost/admin/", { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.getByText("Dashboard", { exact: true }).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const routes = [
    { name: "site-dashboard", path: "/admin/sites/17/admin/" },
    { name: "appearance", path: "/admin/sites/17/admin/appearance" },
    { name: "header", path: "/admin/sites/17/admin/header" },
    { name: "footer", path: "/admin/sites/17/admin/footer" },
    { name: "menus", path: "/admin/sites/17/admin/menus" },
    { name: "pages", path: "/admin/sites/17/admin/pages" },
  ];
  const out = [];
  for (const route of routes) {
    net.length = 0;
    await page.goto(`http://localhost${route.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    // Poll up to 90s for loading to clear
    let settled = false;
    for (let i = 0; i < 45; i++) {
      const text = await page.locator("body").innerText();
      if (!/Loading Site workspace|Loading navigation|Loading workspace/i.test(text)) {
        settled = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(1000);
    await page.addScriptTag({ path: path.resolve(AXE) });
    const axe = await page.evaluate(async () => {
      const r = await axe.run({ exclude: [["nextjs-portal"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } });
      return {
        violationCount: r.violations.length,
        violations: r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
        })),
      };
    });
    const meta = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim()).filter(Boolean),
      bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
      stillLoading: /Loading Site workspace|Loading navigation/i.test(document.body.innerText),
    }));
    await page.screenshot({ path: path.join(OUT, `admin-${route.name}-1440.png`), fullPage: false });
    out.push({ ...route, settled, ...meta, axe, apiSample: net.slice(0, 20) });
  }
  fs.writeFileSync(path.join(OUT, "admin-site17.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.map((s) => ({
    name: s.name,
    settled: s.settled,
    stillLoading: s.stillLoading,
    h1: s.h1,
    viol: s.axe.violationCount,
    ids: s.axe.violations.map((v) => v.id),
    apiFails: s.apiSample.filter((x) => x.status >= 400),
  })), null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
