const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("./perf/node_modules/playwright-core");
const OUT = path.resolve("docs/qa/chrome-audit-2026-11-26");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-proxy-server", "--host-resolver-rules=MAP *.uog.local 127.0.0.1"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  // Search dialog
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Search this Site" }).click();
  await page.waitForTimeout(700);
  const searchFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    role: document.activeElement?.getAttribute("role") || "",
    ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
    name: document.activeElement?.getAttribute("name") || "",
    id: document.activeElement?.id || "",
    labelledBy: document.activeElement?.getAttribute("aria-labelledby") || "",
  }));
  // Prefer typed input via role
  const inputFocused = await page.getByRole("textbox", { name: /Search published Pages and news/i }).evaluate((el) => el === document.activeElement).catch(() => false);
  await page.getByRole("textbox", { name: /Search published Pages and news/i }).fill("QA");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "search-results-1440.png"), fullPage: false });
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return {
      present: !!d,
      labelledBy: d?.getAttribute("aria-labelledby") || "",
      label: d?.getAttribute("aria-label") || "",
      activeInside: !!d?.contains(document.activeElement),
    };
  });
  // Tab trap sample
  const beforeTab = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const afterTabsInside = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!d?.contains(document.activeElement);
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const afterEscape = await page.evaluate(() => ({
    dialog: !!document.querySelector('[role="dialog"]'),
    focusLabel: document.activeElement?.getAttribute("aria-label") || "",
  }));

  // Mobile header drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://www.uog.local/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Open site header" }).click();
  await page.waitForTimeout(600);
  const drawerFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    ariaLabel: document.activeElement?.getAttribute("aria-label") || "",
    text: (document.activeElement?.textContent || "").trim().slice(0, 60),
  }));
  await page.screenshot({ path: path.join(OUT, "drawer-open-390.png"), fullPage: false });
  let tabStayedInside = true;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"], .MuiDrawer-root, [class*="Drawer"]');
      // header expanded region: look for Close control
      const close = document.querySelector('button[aria-label*="Close" i]');
      const root = panel || close?.closest("header") || document.querySelector("header");
      return !!root?.contains(document.activeElement);
    });
    if (!inside) tabStayedInside = false;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const drawerAfter = await page.evaluate(() => ({
    closeStillPresent: !!document.querySelector('button[aria-label="Close site header"], button[aria-label*="Close" i]'),
    focusLabel: document.activeElement?.getAttribute("aria-label") || "",
  }));

  const result = {
    search: {
      check: "search dialog",
      initialFocus: searchFocus,
      inputFocused,
      dialog,
      beforeTab,
      tabStayedInside: afterTabsInside,
      escapeClosed: !afterEscape.dialog,
      focusRestored: afterEscape.focusLabel === "Search this Site",
      restoredLabel: afterEscape.focusLabel,
    },
    drawer: {
      check: "mobile drawer",
      initialFocus: drawerFocus,
      closeFocused: /Close site header/i.test(drawerFocus.ariaLabel || ""),
      tabStayedInside,
      escapeClosed: !drawerAfter.closeStillPresent || drawerAfter.focusLabel === "Open site header",
      focusRestored: drawerAfter.focusLabel === "Open site header",
      restoredLabel: drawerAfter.focusLabel,
      note: "Public chrome uses 'Open site header' disclosure, not a separate navigation drawer role.",
    },
  };
  fs.writeFileSync(path.join(OUT, "keyboard.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
