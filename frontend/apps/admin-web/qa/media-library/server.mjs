/**
 * Local fixture server for the Informatics ↔ Medicine browse harness.
 * Delays Site 11 searches so a Site switch can race a late response.
 *
 *   node server.mjs
 *   open http://127.0.0.1:4177/
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../dist/media-library-qa");
const port = Number(process.env.MEDIA_QA_PORT || 4177);
const delayMs = Number(process.env.MEDIA_QA_DELAY_MS || 1500);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const catalogs = {
  11: [{ id: "informatics-1", site: 11, original_filename: "informatics.png", detected_mime: "image/png", status: "READY", processing_state: "READY", byte_count: 120, alt_text: "Informatics", content_type: "image/png", thumbnail_status: "NOT_GENERATED", thumbnail_url: null, updated_at: "2026-11-11T00:00:00Z" }],
  22: [{ id: "medicine-1", site: 22, original_filename: "medicine.png", detected_mime: "image/png", status: "READY", processing_state: "READY", byte_count: 140, alt_text: "Medicine", content_type: "image/png", thumbnail_status: "NOT_GENERATED", thumbnail_url: null, updated_at: "2026-11-11T00:00:00Z" }],
};

function page(results) {
  return JSON.stringify({ ok: true, data: { count: results.length, next: null, previous: null, results } });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith("/fixture/sites/") && url.pathname.endsWith("/media")) {
    const site = Number(url.pathname.split("/")[3]);
    const search = url.searchParams.get("search") || "";
    const rows = (catalogs[site] || []).filter((asset) => !search || asset.original_filename.includes(search));
    const wait = site === 11 && search ? delayMs : 0;
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(page(rows));
    }, wait);
    return;
  }
  const relative = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": types[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Media browse fixture http://127.0.0.1:${port}/ (Informatics search delay ${delayMs}ms)`);
});
