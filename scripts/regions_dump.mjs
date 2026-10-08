// Region-map dump: develops each photo through the real app (person mask included when the
// analysis has one), calls the DEV hook window.__myfuji.regions(), and writes a 2×2 overlay
// sheet per photo (sky / foliage / ground / sun) to <out>/<stem>.jpg via scripts/regions_sheet.py.
//
//   PROBE_PORT=5223 node scripts/regions_dump.mjs                 # the nine test photos in dev/imgs
//   PROBE_PORT=5223 node scripts/regions_dump.mjs dev/imgs/p1005.jpg --out batch/regions
//
// <out>/summary.json has per-photo grid size, warm/cold computeRegions ms (measured in the page)
// and whether a person mask was applied.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 5223);
const BASE = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : 'batch/regions');
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const STEMS = ['forest', 'p1005', 'p1015', 'p1027', 'p1043', 'p1047', 'p1059', 'p1080', 'p1084'];
const IMGS = inputs.length
  ? inputs.map((a) => resolve(ROOT, a))
  : STEMS.map((s) => {
    const f = readdirSync(join(ROOT, 'dev/imgs')).find((n) => n.replace(/\.[^.]+$/, '') === s);
    if (!f) throw new Error(`missing dev/imgs/${s}.*`);
    return join(ROOT, 'dev/imgs', f);
  });

const CHROME = [
  process.env.PROBE_CHROME,
  join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('No Chromium found: set PROBE_CHROME');

const log = (...a) => console.log('[regions]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

mkdirSync(OUT, { recursive: true });
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let viteExit = null;
vite.on('exit', (code) => { viteExit = code; });
const viteLog = [];
vite.stdout.on('data', (d) => viteLog.push(String(d)));
vite.stderr.on('data', (d) => viteLog.push(String(d)));
const stopVite = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ } };

let browser;
const summary = [];
try {
  await waitFor(async () => (await fetch(BASE)).ok || viteExit !== null, 90_000, 'vite');
  if (viteExit !== null) throw new Error('vite exited early:\n' + viteLog.join('').slice(-800));
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('console.error:', m.text().slice(0, 300)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__myfuji, null, { timeout: 60_000 });
  for (const IMG of IMGS) {
    const name = IMG.split('/').pop();
    const stem = name.replace(/\.[^.]+$/, '');
    const t0 = Date.now();
    try {
      const got = await page.evaluate(([n, b64]) => window.__myfuji.load(n, b64), [name, readFileSync(IMG).toString('base64')]);
      if (got.name !== name) throw new Error(`developed "${got.name}" instead of "${name}" (an earlier photo finished late)`);
      const r = await page.evaluate(() => window.__myfuji.regions());
      const maps = { sky: r.sky, foliage: r.foliage, ground: r.ground, sun: r.sun };
      const sheet = spawnSync('python3', ['-I', join(ROOT, 'scripts/regions_sheet.py'), IMG, join(OUT, `${stem}.jpg`)], {
        input: JSON.stringify({ w: r.w, h: r.h, maps }), encoding: 'utf8', maxBuffer: 64 << 20,
      });
      if (sheet.status !== 0) throw new Error('regions_sheet.py: ' + String(sheet.stderr).slice(-400));
      const row = { image: name, w: r.w, h: r.h, ms: r.ms, coldMs: r.coldMs, hasMask: r.hasMask, wallMs: Date.now() - t0, sheet: `${stem}.jpg` };
      summary.push(row);
      log(`${name}: ${r.w}x${r.h} regions ${r.ms} ms warm (${r.coldMs} cold), mask ${r.hasMask ? 'yes' : 'no'}`);
    } catch (e) {
      log(`${name}: FAILED`, e.message);
      summary.push({ image: name, error: e.message });
    }
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
} finally {
  await browser?.close().catch(() => {});
  stopVite();
}
process.exit(0);
