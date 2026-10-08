// Headless probe: develops one photo through the real app (via the DEV-only
// window.__myfuji hook in src/debug.ts) and records what the app does to it.
//
//   node scripts/probe.mjs [image] [--out probe]
//
// Writes <out>/analysis.json, <out>/auto.png (auto pick, full res) and
// <out>/<sim>.png for each of the 14 sims with otherwise-auto params.
// Starts `npx vite --port 5199` as a child process and stops it on exit.
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
const IMG = resolve(ROOT, args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') ?? 'test-forest.jpg');

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
try {
  await waitFor(async () => (await fetch(BASE)).ok || viteExit !== null, 90_000, 'vite');
  if (viteExit !== null) throw new Error('vite exited early:\n' + viteLog.join('').slice(-800));
  log('vite up on', BASE);

  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('INFO:')) log('console.error:', m.text().slice(0, 300)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__myfuji, null, { timeout: 60_000 });
  const gl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  log('WebGL2 available:', gl2);
  if (!gl2) throw new Error('WebGL2 unavailable in this Chromium');

  // Load the photo through the app's own queue (enqueue -> processFile).
  const name = IMG.split('/').pop();
  const t0 = Date.now();
  const loaded = await page.evaluate(([n, b64]) => window.__myfuji.load(n, b64), [name, readFileSync(IMG).toString('base64')]);
  log(`developed ${name} in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, `${loaded.w}x${loaded.h}`, loaded.notes.join('; ') || '-');

  const analysis = await page.evaluate(() => JSON.parse(JSON.stringify(window.__myfuji.analysis())));
  const sims = await page.evaluate(() => window.__myfuji.sims);
  const simParams = {};
  for (const s of sims) simParams[s] = await page.evaluate((x) => JSON.parse(JSON.stringify(window.__myfuji.autoFor(x))), s);

  const renders = [];
  const save = (dataUrl, file) => {
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    writeFileSync(join(OUT, file), buf);
    return buf.length;
  };
  // Auto first: reset to the auto params so this is exactly what the app shows.
  const shot = async (label, fn, arg) => {
    const t = Date.now();
    const r = await page.evaluate(fn, arg);
    const bytes = save(r.dataUrl, `${label}.png`);
    renders.push({ file: `${label}.png`, bytes, ms: Date.now() - t });
    log(`wrote ${label}.png (${(bytes / 1e6).toFixed(2)} MB, ${Date.now() - t} ms)`);
  };
  await shot('auto', () => { window.__myfuji.setParams({}, 'auto'); return window.__myfuji.render(); });
  for (const s of sims) await shot(s, (x) => window.__myfuji.render(x), s);
  // Controls. prefilm = auto with the film LUT removed (intensity 0): WB, exposure, local tone, shoulder remain.
  await shot('control-prefilm', () => { window.__myfuji.setParams({}, 'auto'); return window.__myfuji.render(undefined, { intensity: 0 }); });
  // neutral = every grade step off (WB identity, no tone/colour/sharpen/halation/fade/leak/vignette/grain/film).
  // Left on: the DR-100 shoulder and the decode -> working space -> sRGB round-trip, so this is a
  // pipeline round-trip baseline, not a perfect identity.
  const NEUTRAL = {
    intensity: 0, exposure: 0, wbMode: 'as-shot', wbShiftR: 0, wbShiftB: 0,
    highlight: 0, shadow: 0, color: 0, sharpness: 0, clarity: 0, smartLight: 0, subjectLift: 0,
    skinProtect: false, cce: 'off', cceBlue: 'off', grain: 'off', vignette: 0, halation: 0,
    fade: 0, lightLeak: 0, dr: 100,
  };
  await shot('control-neutral', (p) => { window.__myfuji.setParams({}, 'auto'); return window.__myfuji.render(undefined, p); }, NEUTRAL);
  // Ablation: auto grade with camera white balance instead of the estimated illuminant.
  await shot('ablate-wb-asshot', () => { window.__myfuji.setParams({}, 'auto'); return window.__myfuji.render(undefined, { wbMode: 'as-shot' }); });
  // Leave the app on auto again.
  await page.evaluate(() => window.__myfuji.setParams({}, 'auto'));

  writeFileSync(join(OUT, 'analysis.json'), JSON.stringify({ image: name, loaded, ...analysis, simParams, renders }, null, 2) + '\n');
  log('wrote analysis.json; picks:', analysis.rec.picks.slice(0, 3).map((p) => `${p.sim} ${p.score}`).join(', '));
} finally {
  await browser?.close().catch(() => {});
  stopVite();
}
