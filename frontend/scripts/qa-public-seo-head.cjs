/* Fetch rendered Next.js document heads with a supplied public Host. */
const assert = require("node:assert/strict");
const http = require("node:http");

function getPage(host, path) {
  return new Promise((resolve, reject) => {
    const request = http.request(`http://localhost:3000${path}`, { headers: { Host: host } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, html: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function check({ host, path, expectedCanonical, expectedTitle, expectedDescription, forbidden = [] }) {
  const response = await getPage(host, path);
  assert.equal(response.status, 200, `${host}${path} should render`);
  const html = response.html;
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  assert.ok(head, "SSR response should contain a head");
  const canonicals = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)];
  assert.equal(canonicals.length, 1, `${host}${path} should render one canonical`);
  assert.match(canonicals[0][0], new RegExp(`href="${expectedCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(html, /og:image|private-media|platform-private/i, "unavailable image must not expose a URL");
  if (expectedTitle) assert.ok(html.includes(`<title>${expectedTitle}</title>`), "explicit title should render in document");
  if (expectedDescription) assert.ok(html.includes(`name="description" content="${expectedDescription}"`), "published fallback description should render");
  for (const value of forbidden) assert.ok(!html.includes(value), `private or foreign metadata must not leak: ${value}`);
  console.log(`PASS ${host}${path}: canonical=${expectedCanonical}; title=${expectedTitle ?? "published fallback"}`);
  return html;
}

(async () => {
  const primary = "hometpl-e993407f76a.uog.local";
  const alias = "seo-e2e-alias.uog.local";
  const run = process.env.SEO_RUN;
  if (run) {
    const pagePath = `/seo-public-${run}`;
    const expected = `http://${primary}${pagePath}`;
    await check({ host: primary, path: pagePath, expectedCanonical: expected, expectedTitle: `Explicit SEO title ${run}` });
    await check({ host: primary, path: `${pagePath}?site_id=42&site=42`, expectedCanonical: expected, expectedTitle: `Explicit SEO title ${run}`, forbidden: [`Foreign title must not leak ${run}`] });
    await check({ host: alias, path: pagePath, expectedCanonical: expected, expectedTitle: `Explicit SEO title ${run}` });
    const foreignPath = `/seo-foreign-${run}`;
    await check({ host: process.env.SEO_HOST_B, path: foreignPath, expectedCanonical: `http://${process.env.SEO_HOST_B}${foreignPath}`, expectedTitle: `Foreign title must not leak ${run}` });

    const draft = await getPage(primary, `/seo-draft-${run}`);
    assert.equal(draft.status, 200);
    assert.ok(!draft.html.includes(`Secret draft SEO ${run}`) && !draft.html.includes(`Secret draft description ${run}`), "draft metadata must not leak");
    assert.equal([...draft.html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)].length, 0, "draft route must not receive canonical metadata");
    console.log(`PASS ${primary}/seo-draft-${run}: no draft SEO or canonical in SSR response`);

    const postPath = `/posts/seo-post-${run}`;
    await check({ host: primary, path: postPath, expectedCanonical: `http://${primary}${postPath}`, expectedDescription: `Published excerpt fallback ${run}` });

    const hostileQuery = await getPage(primary, `${pagePath}?title=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
    assert.ok(!hostileQuery.html.includes("<script>alert(1)</script>"), "unsafe query text must not inject markup into document");
    console.log(`PASS ${primary}${pagePath}: hostile query text is not reflected into the document`);
    assert.equal(process.env.SEO_UNSAFE_REJECTED, "true", "unsafe SEO markup should be rejected by backend validation");
    console.log("PASS unsafe SEO input rejected before publication");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
