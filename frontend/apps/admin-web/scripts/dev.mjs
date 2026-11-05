// Compile common protected screens before their first click. This is only
// used by `pnpm dev`; production still uses next build / next start.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const port = process.env.PORT || '3000';
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', port, ...process.argv.slice(2)], { stdio: 'inherit' });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  next.kill(signal);
});
next.on('error', () => process.exit(1));
next.on('exit', code => { stopping = true; process.exit(code ?? 0); });

async function warm() {
  // Anonymous GETs compile route entries without loading authenticated data,
  // retaining cookies, or bypassing the normal layout/backend permission gates.
  const routes = ['/admin', '/admin/api/session', '/admin/organizations', '/admin/sites', '/admin/domains'];
  const deadline = Date.now() + 180_000;
  for (const route of routes) {
    let ready = false;
    for (let attempt = 0; attempt < 120 && !stopping && Date.now() < deadline; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(120_000, deadline - Date.now()))) });
        await response.arrayBuffer();
        if (response.status < 500) { ready = true; break; }
      } catch { /* Next may still be starting. */ }
      await delay(500);
    }
    if (stopping) return;
    if (!ready) { console.warn(`[admin] Could not warm ${route}; normal on-demand compilation remains available.`); return; }
  }
  console.log('[admin] Common navigation routes warmed.');
}
void warm();
