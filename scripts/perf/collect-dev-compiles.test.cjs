const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "collect-dev-compiles.cjs");

test("records compile durations without retaining request data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uog-dev-compile-"));
  const output = path.join(directory, "compilations.json");
  try {
    const result = spawnSync(process.execPath, [script, output], {
      input: "✓ Compiled /sites/[id]/admin/pages in 1.25s (220 modules)\n✓ Compiled /sites/11/admin?secret=hidden in 8ms",
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.deepEqual(report.first_compilation_by_route, [
      { route: "/sites/[id]/admin/pages", duration_ms: 1250, modules: 220 },
    ]);
    assert.equal(fs.readFileSync(output, "utf8").includes("secret"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails explicitly when the server log has no compilation events", () => {
  const result = spawnSync(process.execPath, [script, path.join(os.tmpdir(), "uog-no-compilations.json")], {
    input: "Next.js is ready",
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No Next\.js development compilation events/);
});
