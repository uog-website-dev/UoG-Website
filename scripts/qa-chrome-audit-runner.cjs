/**
 * Read-only P4-F-CHROME audit runner. Does not mutate product fixtures.
 * Holds PostgreSQL SHARE locks during collection (AC-03).
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("./perf/node_modules/playwright-core");

const OUT = path.resolve(process.env.UOG_CHROME_AUDIT_OUT || "docs/qa/chrome-audit-2026-11-26");
const EDGE = process.env.UOG_QA_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const AXE = process.env.UOG_QA_AXE_PATH || ".git/task-data/release-tools/node_modules/axe-core/axe.min.js";
const WIDTHS_FULL = [320, 360, 390, 768, 1024, 1280, 1440, 1920];
const WIDTHS_AXE = [1440, 390];

const TARGETS = [
  { id: "home-main", host: "www.uog.local", path: "/", template: "Homepage" },
  { id: "home-child", host: "coi.uog.local", path: "/", template: "Homepage (child Site)" },
  { id: "page", host: "www.uog.local", path: "/mainqa-8995d437-information", template: "Page" },
  { id: "posts", host: "aau-review.localhost", path: "/posts", template: "Post list" },
  { id: "post-detail", host: "aau-review.localhost", path: "/posts/aau-reference-dd1aa7a8", template: "Post detail" },
  { id: "category", host: "article-media-post-14a6169c2f.uog.local", path: "/posts/categories/research-655af51c8f", template: "Category archive" },
  { id: "category-empty", host: "article-media-post-14a6169c2f.uog.local", path: "/posts/categories/empty-655af51c8f", template: "Empty category" },
  { id: "404", host: "aau-review.localhost", path: "/does-not-exist-audit", template: "Not found" },
  { id: "sidebar-left", host: "layout-45dfd491f4a.uog.local", path: "/left-sidebar", template: "Left sidebar" },
  { id: "sidebar-right", host: "layout-45dfd491f4a.uog.local", path: "/right-sidebar", template: "Right sidebar" },
  { id: "home-empty", host: "cmhs.uog.local", path: "/", template: "Empty homepage" },
  { id: "posts-disabled", host: "news-disabled-post-14a6169c2f.uog.local", path: "/posts", template: "POSTS disabled" },
];

const MATRIX_IDS = new Set(["home-main", "page", "posts", "post-detail", "category", "home-empty"]);

fs.mkdirSync(OUT, { recursive: true });

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function urlOf(t) {
  return `http://${t.host}${t.path}`;
}

async function httpCheck(host, routePath) {
  const res = await fetch(`http://127.0.0.1${routePath}`, { headers: { Host: host }, redirect: "manual" });
  const text = await res.text();
  return {
    host,
    path: routePath,
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    bodyStart: text.slice(0, 160).replace(/\s+/g, " "),
  };
}

function startShareLock(seconds = 900) {
  const sql = `
BEGIN;
LOCK TABLE cms_page, api_page, api_post, cms_menu, cms_menuitem,
           cms_menulocationassignment, sites_site, sites_siteheader,
           sites_sitefooter
  IN SHARE MODE;
SELECT pg_sleep(${seconds});
COMMIT;
`;
  const child = spawn(
    "docker",
    ["exec", "-i", "uog-postgres", "psql", "-U", "uog_admin", "-d", "uog_db", "-v", "ON_ERROR_STOP=1"],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  child.stdin.end(sql);
  return child;
}

async function proveWriteBlocked() {
  const sql = `
BEGIN;
SET LOCAL lock_timeout='400ms';
UPDATE cms_page SET title=title
WHERE sitecontent_ptr_id=(SELECT sitecontent_ptr_id FROM cms_page LIMIT 1);
COMMIT;
`;
  return await new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", "uog-postgres", "psql", "-U", "uog_admin", "-d", "uog_db", "-v", "ON_ERROR_STOP=1"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let err = "";
    let out = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stdin.end(sql);
    child.on("close", (code) => resolve({ code, out, err, blocked: /lock timeout|canceling statement/i.test(err + out) }));
  });
}

async function settle(page) {
  await page.waitForTimeout(1400);
  await page.getByText(/Loading homepage|Loading posts|Loading page|Loading article|Loading published/i).waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
}

async function extractMeta(page) {
  return page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
    const h1 = [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim() || "");
    const landmarks = [...document.querySelectorAll("header,main,footer,nav,[role=banner],[role=main],[role=contentinfo],[role=navigation]")].map((n) => ({
      tag: n.tagName.toLowerCase(),
      role: n.getAttribute("role") || "",
      label: n.getAttribute("aria-label") || "",
    }));
    return {
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      ogUrl: meta('meta[property="og:url"]'),
      hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((n) => ({ lang: n.getAttribute("hreflang"), href: n.href })),
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
      h1,
      landmarks,
      lang: document.documentElement.lang || "",
    };
  });
}

async function runAxe(page) {
  await page.addScriptTag({ path: path.resolve(AXE) });
  return page.evaluate(async () => {
    const r = await axe.run(
      { exclude: [["nextjs-portal"]] },
      { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } },
    );
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
      incomplete: r.incomplete.map((x) => ({ id: x.id, nodes: x.nodes.length })),
      passes: r.passes.length,
    };
  });
}

async function measurePerf(page, target) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(urlOf(target), { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0;
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : 0;
    const shifts = performance.getEntriesByType("layout-shift").filter((s) => !s.hadRecentInput);
    const cls = shifts.reduce((sum, s) => sum + s.value, 0);
    const fonts = [...document.fonts].map((f) => ({ family: f.family, status: f.status }));
    const images = [...document.images].slice(0, 12).map((img) => ({
      loading: img.loading || "auto",
      widthAttr: img.getAttribute("width"),
      heightAttr: img.getAttribute("height"),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      src: (img.currentSrc || img.src || "").slice(0, 120),
    }));
    return {
      fcp: Math.round(fcp),
      lcp: Math.round(lcp),
      cls: Number(cls.toFixed(3)),
      shifts: shifts.slice(0, 8).map((s) => ({ value: Number(s.value.toFixed(3)), sources: (s.sources || []).map((x) => x.node?.tagName || "?") })),
      fonts,
      images,
      lazyImages: images.filter((i) => i.loading === "lazy").length,
      eagerImages: images.filter((i) => i.loading !== "lazy").length,
    };
  });
}

async function responsiveProbe(page, target, width) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(urlOf(target), { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  const row = await page.evaluate(() => {
    const brand = document.querySelector('[data-site-brand], header h1, header .MuiTypography-root, header [class*="brand"]');
    const brandClip = brand ? brand.scrollWidth > brand.clientWidth + 1 : false;
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const header = document.querySelector("header");
    return {
      overflow,
      documentWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
      brandClip,
      brandText: brand?.textContent?.trim()?.slice(0, 80) || "",
    };
  });
  if ([320, 390, 768, 1440].includes(width)) {
    await page.screenshot({ path: path.join(OUT, `${target.id}-${width}.png`), fullPage: false });
  }
  return { id: target.id, width, ...row };
}

async function keyboardSearch(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  const trigger = page.getByRole("button", { name: /Search this Site|Search/i }).first();
  await trigger.click();
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    role: document.activeElement?.getAttribute("role") || "",
    label: document.activeElement?.getAttribute("aria-label") || "",
    name: document.activeElement?.getAttribute("name") || "",
  }));
  await page.keyboard.type("QA");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "search-results-1440.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(OUT, "search-results-390.png"), fullPage: false });
  return { initialFocus: before };
}

async function keyboardDrawer(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  const open = page.getByRole("button", { name: /Open navigation|Menu|navigation menu/i }).first();
  await open.click();
  await page.waitForTimeout(500);
  const focus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    label: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim()?.slice(0, 60) || "",
  }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim()?.slice(0, 60) || "");
  await page.screenshot({ path: path.join(OUT, "home-main-390.png"), fullPage: false });
  return { initialFocus: focus, restoredTo: restored };
}

(async () => {
  const startedAt = new Date().toISOString();
  const lock = startShareLock(1200);
  await new Promise((r) => setTimeout(r, 1500));
  const writeProof = await proveWriteBlocked();

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-proxy-server", "--host-resolver-rules=MAP *.uog.local 127.0.0.1,MAP aau-review.localhost 127.0.0.1"],
  });

  const a11y = [];
  const metadata = [];
  const responsive = [];
  const performance = [];
  const keyboard = {};
  const errors = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(45000);

    write("http-checks.json", [
      await httpCheck("www.uog.local", "/robots.txt"),
      await httpCheck("www.uog.local", "/sitemap.xml"),
      await httpCheck("www.uog.local", "/favicon.ico"),
      await httpCheck("aau-review.localhost", "/does-not-exist-audit"),
    ]);

    for (const target of TARGETS) {
      for (const width of WIDTHS_AXE) {
        try {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
          const res = await page.goto(urlOf(target), { waitUntil: "domcontentloaded", timeout: 120000 });
          await settle(page);
          const axe = await runAxe(page);
          const meta = await extractMeta(page);
          a11y.push({
            id: target.id,
            template: target.template,
            url: urlOf(target),
            width,
            status: res?.status() || 0,
            violationCount: axe.violations.length,
            ...axe,
          });
          if (width === 1440) metadata.push({ id: target.id, url: urlOf(target), ...meta });
          await page.screenshot({ path: path.join(OUT, `${target.id}-${width}.png`), fullPage: false });
        } catch (e) {
          errors.push({ phase: "axe", id: target.id, width, error: String(e.message || e) });
        }
      }
    }

    for (const target of TARGETS.filter((t) => MATRIX_IDS.has(t.id))) {
      for (const width of WIDTHS_FULL) {
        try {
          responsive.push(await responsiveProbe(page, target, width));
        } catch (e) {
          errors.push({ phase: "responsive", id: target.id, width, error: String(e.message || e) });
        }
      }
    }

    for (const id of ["home-main", "page", "posts", "post-detail", "sidebar-left"]) {
      const target = TARGETS.find((t) => t.id === id);
      try {
        performance.push({ id, url: urlOf(target), ...(await measurePerf(page, target)) });
      } catch (e) {
        errors.push({ phase: "perf", id, error: String(e.message || e) });
      }
    }

    try { keyboard.search = await keyboardSearch(page); } catch (e) { errors.push({ phase: "keyboard-search", error: String(e.message || e) }); }
    try { keyboard.drawer = await keyboardDrawer(page); } catch (e) { errors.push({ phase: "keyboard-drawer", error: String(e.message || e) }); }

    await context.close();
  } finally {
    await browser.close();
    lock.kill("SIGTERM");
  }

  const fixtureCounts = await new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "uog-postgres", "psql", "-U", "uog_admin", "-d", "uog_db", "-t", "-A", "-c",
        "select count(*) from sites_site;"],
      { windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out.trim()));
  }).catch(() => "");

  write("public-accessibility.json", a11y);
  write("metadata.json", metadata);
  write("responsive.json", responsive);
  write("performance.json", performance);
  write("keyboard.json", keyboard);
  write("errors.json", errors);
  write("public-run.json", {
    startedAt,
    finishedAt: new Date().toISOString(),
    browser: "Edge headless via playwright-core",
    axe: "4.14.0",
    targets: TARGETS.map((t) => ({ ...t, url: urlOf(t) })),
  });
  write("isolation.json", {
    lockMode: "SHARE",
    heldDuringCollection: true,
    writeAttemptBlocked: writeProof.blocked,
    writeProof,
    note: "SHARE lock started before first audited navigation and held for the browser collection window.",
  });
  write("environment.json", {
    audit: "P4-F-CHROME remaining public/admin surfaces — re-verification",
    capturedAt: new Date().toISOString(),
    repositoryCommit: process.env.UOG_AUDIT_COMMIT || "",
    productCodeChangedByAudit: false,
    reviewHosts: {
      main: "www.uog.local",
      childSites: ["coi.uog.local", "aau-review.localhost", "article-media-post-14a6169c2f.uog.local", "layout-45dfd491f4a.uog.local", "cmhs.uog.local", "news-disabled-post-14a6169c2f.uog.local"],
    },
    tools: { browser: EDGE, axePath: AXE, method: "playwright-core + axe-core + PerformanceObserver" },
    fixtureHint: fixtureCounts,
    priorPack: "docs/qa/chrome-audit-2026-11-24/",
    isolation: "SHARE during collection; see isolation.json",
  });

  console.log(JSON.stringify({
    out: OUT,
    a11y: a11y.length,
    responsive: responsive.length,
    performance: performance.length,
    violations: a11y.reduce((n, r) => n + r.violationCount, 0),
    errors: errors.length,
    writeBlocked: writeProof.blocked,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
