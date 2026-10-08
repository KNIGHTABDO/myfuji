// Batch probe: develops many photos through the real app with AUTO settings only
// (one vite + one browser for the whole batch) and makes a before/after sheet.
//
//   PROBE_PORT=5201 node scripts/batch.mjs dev/imgs/*.jpg test-forest.jpg --out batch
//
// Writes <out>/<name>.auto.jpg, <out>/summary.json (lighting, subject, sim, key params per image)
// and <out>/sheet.jpg (source | auto pairs, via scripts/sheet.py).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 5199);
const BASE = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : 'probe');
const IMGS = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out').map((a) => resolve(ROOT, a));

const CHROME = [
  process.env.PROBE_CHROME,
  join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('No Chromium found: set PROBE_CHROME');

const log = (...a) => console.log('[probe]', ...a);
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
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('INFO:')) log('console.error:', m.text().slice(0, 300)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__myfuji, null, { timeout: 60_000 });
  for (const IMG of IMGS) {
    const name = IMG.split('/').pop();
    const stem = name.replace(/\.[^.]+$/, '');
    const t0 = Date.now();
    try {
      await page.evaluate(([n, b64]) => window.__myfuji.load(n, b64), [name, readFileSync(IMG).toString('base64')]);
      const a = await page.evaluate(() => JSON.parse(JSON.stringify(window.__myfuji.analysis())));
      const r = await page.evaluate(() => { window.__myfuji.setParams({}, 'auto'); return window.__myfuji.render(); });
      writeFileSync(join(OUT, `${stem}.auto.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'));
      const sc = a.scene ?? {}, p = a.params ?? {};
      const row = { image: name, src: IMG, out: `${stem}.auto.png`, ms: Date.now() - t0,
        lighting: sc.lighting, subject: sc.subject, warmLight: sc.warmLight, backlight: sc.backlight, inputKind: sc.inputKind, gentle: sc.gentle,
        story: sc.story, picks: (a.rec?.picks ?? []).slice(0, 3).map((x) => `${x.sim}:${(+x.score).toFixed(2)}`),
        params: { sim: p.sim, exposure: p.exposure, wbMode: p.wbMode, highlight: p.highlight, shadow: p.shadow, color: p.color, clarity: p.clarity, regions: p.regions },
        uniforms: a.uniforms ? { wb: a.uniforms.wb, compress: a.uniforms.compress, shadowLift: a.uniforms.shadowLift } : undefined };
      summary.push(row);
      log(`${name}: ${row.lighting}/${row.subject} -> ${p.sim} ev ${p.exposure} (${row.ms} ms)`);
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
const py = spawn('python3', ['-I', join(ROOT, 'scripts/sheet.py'), OUT], { stdio: 'inherit' });
await new Promise((r) => py.on('exit', r));
process.exit(0);
