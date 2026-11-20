/** Report route-owned production JS sizes without printing source or build inputs. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
};
const explicitRoot = valueAfter("--root") ?? process.env.PERF_BUILD_ROOT;
const outputFile = valueAfter("--output");
const checkBudgets = args.includes("--check");
const budgetPath = path.join(scriptDir, "bundle-budgets.json");
const budgets = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
const manifestName = path.join(".next", "app-build-manifest.json");

function appRoot(candidate) {
  const resolved = path.resolve(candidate);
  const candidates = [
    resolved,
    path.join(resolved, "apps", "admin-web"),
    path.join(resolved, "frontend", "apps", "admin-web"),
  ];
  return candidates.find((candidateRoot) => fs.existsSync(path.join(candidateRoot, manifestName))) ?? null;
}

const candidateRoots = [];
if (explicitRoot) candidateRoots.push(explicitRoot);
if (fs.existsSync("/tmp")) {
  for (const name of fs.readdirSync("/tmp").filter((entry) => entry.startsWith("uog-perf-"))) {
    candidateRoots.push(path.join("/tmp", name));
  }
}
candidateRoots.push(
  process.cwd(),
  path.resolve(process.cwd(), "..", ".."),
  "/tmp/uog-frontend-build/apps/admin-web",
);
const root = candidateRoots.map(appRoot).find(Boolean);
if (!root) throw new Error("A completed production admin-web build is required (pass --root <admin-web directory>)");

const nextDir = path.join(root, ".next");
if (!fs.existsSync(path.join(nextDir, "BUILD_ID"))) throw new Error("Bundle budgets require a production build, not next dev");
const manifest = JSON.parse(fs.readFileSync(path.join(nextDir, "app-build-manifest.json"), "utf8"));
const routes = {
  shell: "/layout",
  dashboard: "/sites/[id]/admin/page",
  pages: "/sites/[id]/admin/pages/page",
  posts: "/sites/[id]/admin/posts/page",
  media: "/sites/[id]/admin/media/page",
  pageEditor: "/sites/[id]/admin/pages/new/page",
  postEditor: "/sites/[id]/admin/posts/new/page",
  builder: "/sites/[id]/admin/pages/[pageId]/builder/page",
};
const assets = {};

function sizes(file) {
  if (!assets[file]) {
    const bytes = fs.readFileSync(path.join(nextDir, file));
    assets[file] = {
      raw: bytes.length,
      gzip: zlib.gzipSync(bytes).length,
      brotli: zlib.brotliCompressSync(bytes).length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }
  return assets[file];
}

const routeResults = {};
for (const [name, route] of Object.entries(routes)) {
  if (!manifest.pages[route]) throw new Error(`Missing production route in build manifest: ${route}`);
  const segments = route.split("/");
  const layouts = segments.slice(1, -1).map((_, index) => `${segments.slice(0, index + 2).join("/")}/layout`);
  const entries = [...new Set(["/layout", ...layouts, route])];
  const files = [...new Set(entries.flatMap((entry) => manifest.pages[entry] ?? []))]
    .filter((file) => file.endsWith(".js"));
  routeResults[name] = {
    route,
    files,
    raw: files.reduce((total, file) => total + sizes(file).raw, 0),
    gzip: files.reduce((total, file) => total + sizes(file).gzip, 0),
    brotli: files.reduce((total, file) => total + sizes(file).brotli, 0),
  };
}

const tracePath = path.join(nextDir, "trace");
if (!fs.existsSync(tracePath)) throw new Error("Production build did not produce .next/trace");
const traceBytes = fs.readFileSync(tracePath);
const traceEvents = traceBytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Cannot parse Next.js build trace event ${index + 1}`);
  }
});
const flattenedTraceEvents = traceEvents.flatMap(event => Array.isArray(event) ? event : [event]);
const traceSpans = new Map();
for (const event of flattenedTraceEvents) {
  if (typeof event.name !== "string" || !Number.isFinite(event.duration)) continue;
  const span = traceSpans.get(event.name) ?? { name: event.name, count: 0, total_ms: 0, max_ms: 0 };
  const duration = event.duration / 1000;
  span.count += 1;
  span.total_ms += duration;
  span.max_ms = Math.max(span.max_ms, duration);
  traceSpans.set(event.name, span);
}

const overBudget = Object.entries(budgets.route_brotli_bytes).flatMap(([name, ceiling]) => {
  const actual = routeResults[name]?.brotli;
  return actual === undefined || actual > ceiling ? [{ route: name, actual_bytes: actual ?? null, budget_bytes: ceiling }] : [];
});
const report = {
  method: "Sum per-file raw/gzip/Brotli estimates for the route and parent layouts in app-build-manifest. Async chunks are reported separately by browser network traces, not included in initial-route totals.",
  routes: routeResults,
  assets,
  budget_status: overBudget.length ? "exceeded" : "within_budget",
  budget_violations: overBudget,
  build_trace: {
    bytes: traceBytes.length,
    sha256: crypto.createHash("sha256").update(traceBytes).digest("hex"),
    event_count: flattenedTraceEvents.length,
    spans: [...traceSpans.values()]
      .map((span) => ({ ...span, total_ms: Number(span.total_ms.toFixed(3)), max_ms: Number(span.max_ms.toFixed(3)) }))
      .sort((a, b) => b.total_ms - a.total_ms)
      .slice(0, 40),
  },
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) {
  const destination = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(`${destination}.tmp`, serialized);
  fs.renameSync(`${destination}.tmp`, destination);
}
console.log(serialized.trimEnd());
if (checkBudgets && overBudget.length) {
  console.error(`Bundle budgets exceeded for: ${overBudget.map((item) => item.route).join(", ")}`);
  process.exitCode = 1;
}
