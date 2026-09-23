// Dev helper: drive the app in headless Chromium, load photos, capture screens.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const [url, outDir, ...files] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.on('console', (m) => { if (m.type() !== 'debug') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/0-home.png` });
const t0 = Date.now();
await page.setInputFiles('input[type=file]', files);
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/1-developing.png` });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/1b-developing.png` });
await page.waitForSelector('.overlay', { state: 'detached', timeout: 240000 });
console.log('developed in', Date.now() - t0, 'ms');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/2-reading.png` });
for (const [i, tab] of [[3, 'Film'], [4, 'Tune'], [5, 'Print']]) {
  await page.click(`.tabs button:has-text("${tab}")`);
  await page.waitForTimeout(tab === 'Film' ? 5000 : 1200);
  await page.screenshot({ path: `${outDir}/${i}-${tab.toLowerCase()}.png` });
}
const dl = page.waitForEvent('download', { timeout: 120000 });
await page.click('button:has-text("Export this print")');
const d = await dl;
await d.saveAs(`${outDir}/export-${d.suggestedFilename()}`);
console.log('exported', d.suggestedFilename());
await browser.close();
