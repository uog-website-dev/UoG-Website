const fs = require("node:fs");
const path = require("node:path");

const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");

const input = fs.readFileSync(0, "utf8");
const compilations = [];
for (const line of input.split(/\r?\n/)) {
  const match = line.match(/Compiled\s+([^\s]+)\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)(?:\s+\((\d+)\s+modules?\))?/i);
  if (!match) continue;
  if (!match[1].startsWith("/") || match[1].length > 256 || /[?#]/.test(match[1])) continue;
  compilations.push({
    route: match[1],
    duration_ms: Number((Number(match[2]) * (match[3].toLowerCase() === "s" ? 1000 : 1)).toFixed(3)),
    modules: match[4] ? Number(match[4]) : null,
  });
}
if (!compilations.length) throw new Error("No Next.js development compilation events found in server logs");

const firstByRoute = new Map();
for (const compilation of compilations) {
  if (!firstByRoute.has(compilation.route)) firstByRoute.set(compilation.route, compilation);
}
const result = {
  method: "Parsed Next.js development server compilation durations; only normalized route names, durations and module counts are retained.",
  mode: "development",
  compile_events: compilations.length,
  first_compilation_by_route: [...firstByRoute.values()],
};
const destination = path.resolve(output);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(`${destination}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
fs.renameSync(`${destination}.tmp`, destination);
console.log(JSON.stringify({ event: "uog.next.dev.compilations", routes: firstByRoute.size, compile_events: compilations.length }));
