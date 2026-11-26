/**
 * Supplemental read-only chrome audit: keyboard, brand measure, i18n DB, admin axe.
 * Does not mutate fixtures. Does not write credentials into evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

function sql(query) {
  const r = spawnSync("docker", ["exec", "uog-postgres", "psql", "-U", "uog_admin", "-d", "uog_db", "-t", "-A", "-c", query], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

async function settle(page) {
  await page.waitForTimeout(1200);
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
        nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
      passes: r.passes.length,
    };
  });
}

(async () => {
  const env = loadEnv();
  const user = env.KEYCLOAK_DEV_USERNAME || env.DEV_PLATFORM_ADMIN_USERNAME || "devuser";
  const pass = env.KEYCLOAK_DEV_PASSWORD || "";

  const i18n = {
    siteLocales: sql("select coalesce(default_locale,''), count(*) from sites_site group by 1 order by 2 desc;"),
    themeModes: sql("select coalesce(theme_mode,''), count(*) from sites_siteappearance group by 1 order by 2 desc;"),
    siteTypes: sql("select coalesce(site_type,''), count(*) from sites_site group by 1 order by 2 desc;"),
  };
  write("i18n-db.json", i18n);

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-proxy-server", "--host-resolver-rules=MAP *.uog.local 127.0.0.1,MAP aau-review.localhost 127.0.0.1,MAP localhost 127.0.0.1"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // Brand clip measure at desktop widths
  const brand = [];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded" });
    await settle(page);
    brand.push({
      width,
      ...(await page.evaluate(() => {
        const candidates = [...document.querySelectorAll("header *")].filter((n) => /University of G/i.test(n.textContent || "") && (n.children.length === 0 || n.childElementCount === 0));
        const el = candidates.sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0]
          || [...document.querySelectorAll("header [class*='Brand'], header h1, header p, header span")].find((n) => /University|Gondar/i.test(n.textContent || ""));
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        return {
          found: true,
          text: (el.textContent || "").trim().slice(0, 80),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          clipped: el.scrollWidth > el.clientWidth + 1,
          box: { w: Math.round(r.width), h: Math.round(r.height) },
        };
      })),
    });
    await page.screenshot({ path: path.join(OUT, `brand-${width}.png`), fullPage: false });
  }
  write("brand-measure.json", brand);

  // Search keyboard
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded" });
  await settle(page);
  const searchBtn = page.locator('button[aria-label*="Search" i], button:has(svg[data-testid*="Search" i])').first();
  const searchByRole = page.getByRole("button", { name: /Search/i }).first();
  if (await searchByRole.count()) await searchByRole.click();
  else await searchBtn.click();
  await page.waitForTimeout(800);
  const searchFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    role: document.activeElement?.getAttribute("role") || "",
    ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
    type: document.activeElement?.getAttribute("type") || "",
    placeholder: document.activeElement?.getAttribute("placeholder") || "",
    text: (document.activeElement?.textContent || "").trim().slice(0, 40),
  }));
  await page.keyboard.type("QA");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "search-results-1440.png"), fullPage: false });
  const searchDialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return {
      dialogPresent: !!dlg,
      labelledBy: dlg?.getAttribute("aria-labelledby") || "",
      label: dlg?.getAttribute("aria-label") || "",
      inputs: [...document.querySelectorAll('[role="dialog"] input, [role="dialog"] [role="searchbox"]')].map((n) => ({
        tag: n.tagName,
        type: n.getAttribute("type") || "",
        ariaLabel: n.getAttribute("aria-label") || "",
        name: n.getAttribute("name") || "",
      })),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Mobile drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded" });
  await settle(page);
  const drawerButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => ({
      label: b.getAttribute("aria-label") || "",
      text: (b.textContent || "").trim().slice(0, 40),
    })).filter((b) => /menu|nav|drawer|open/i.test(`${b.label} ${b.text}`)),
  );
  let drawer = { buttons: drawerButtons, opened: false };
  const openBtn = page.locator('button[aria-label*="Open navigation" i], button[aria-label*="Menu" i], button[aria-label*="navigation" i]').first();
  if (await openBtn.count()) {
    await openBtn.click();
    await page.waitForTimeout(600);
    drawer = {
      ...drawer,
      opened: true,
      initialFocus: await page.evaluate(() => ({
        tag: document.activeElement?.tagName || "",
        ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
        text: (document.activeElement?.textContent || "").trim().slice(0, 60),
      })),
      panel: await page.evaluate(() => {
        const nav = document.querySelector('[role="dialog"], [role="navigation"], aside, .MuiDrawer-root');
        return {
          tag: nav?.tagName || "",
          role: nav?.getAttribute("role") || "",
          label: nav?.getAttribute("aria-label") || "",
        };
      }),
    };
    await page.screenshot({ path: path.join(OUT, "drawer-open-390.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    drawer.restoredTo = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || (document.activeElement?.textContent || "").trim().slice(0, 60));
  }
  write("keyboard-supplement.json", { searchFocus, searchDialog, drawer });

  // 404 DOM note
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://aau-review.localhost/does-not-exist-audit", { waitUntil: "domcontentloaded" });
  await settle(page);
  write("404-dom.json", await page.evaluate(() => ({
    title: document.title,
    statusHint: document.body.innerText.slice(0, 300),
    h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim()),
    breadcrumbs: [...document.querySelectorAll("nav[aria-label*='breadcrumb' i] a, [class*='Breadcrumb'] a, ol li")].map((n) => n.textContent?.trim()).filter(Boolean),
  })));

  // Admin login + key surfaces
  const admin = [];
  const adminErrors = [];
  try {
    await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000);
    // Keycloak login form
    const userField = page.locator("#username, input[name='username']").first();
    if (await userField.count()) {
      await userField.fill(user);
      await page.locator("#password, input[name='password']").first().fill(pass);
      await page.locator("#kc-login, button[type='submit']").first().click();
      await page.waitForTimeout(4000);
    }
    await page.waitForURL(/\/admin/, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

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
      try {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const started = Date.now();
        const res = await page.goto(`http://localhost${route.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForTimeout(2500);
        const readyMs = Date.now() - started;
        const meta = await page.evaluate(() => ({
          title: document.title,
          h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim()).filter(Boolean),
          bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 420),
        }));
        const axe = await runAxe(page);
        await page.screenshot({ path: path.join(OUT, `admin-${route.name}-1440.png`), fullPage: false });
        admin.push({
          name: route.name,
          route: route.path,
          status: res?.status() || 0,
          readyMs,
          ...meta,
          axe,
        });
      } catch (e) {
        adminErrors.push({ route: route.name, error: String(e.message || e) });
      }
    }

    // Admin mobile drawer
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost/admin/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const adminOpen = page.getByRole("button", { name: /Open navigation menu|Menu/i }).first();
    if (await adminOpen.count()) {
      await adminOpen.click();
      await page.waitForTimeout(500);
      const focus = await page.evaluate(() => ({
        ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
        text: (document.activeElement?.textContent || "").trim().slice(0, 40),
      }));
      await page.screenshot({ path: path.join(OUT, "admin-mobile-nav-open.png"), fullPage: false });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      write("admin-mobile-keyboard.json", {
        opened: true,
        initialFocus: focus,
        restoredTo: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || ""),
      });
    }
  } catch (e) {
    adminErrors.push({ phase: "admin", error: String(e.message || e) });
  }

  write("admin.json", admin);
  write("admin-errors.json", adminErrors);

  await browser.close();
  console.log(JSON.stringify({
    brandClipped: brand.filter((b) => b.clipped).map((b) => b.width),
    searchFocus,
    drawerOpened: drawer.opened,
    adminScreens: admin.length,
    adminViolations: admin.reduce((n, s) => n + (s.axe?.violationCount || 0), 0),
    adminErrors: adminErrors.length,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
