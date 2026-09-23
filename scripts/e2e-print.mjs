// Dev helper: develop one photo, then export it with several print styles.
import { chromium } from 'playwright-core';
const [url, outDir, file] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', [file]);
await page.waitForSelector('.overlay', { state: 'detached', timeout: 300000 });
await page.click('.tabs button:has-text("Film")');
await page.waitForTimeout(6000);
await page.locator('.sim-grid').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outDir}/contact.png` });
await page.click('.tabs button:has-text("Print")');
await page.click('.toggle:has-text("date stamp")');
for (const f of ['35mm strip', 'Instant', 'Shot-on caption']) {
  await page.click(`.frame-opt:has-text("${f}")`);
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await page.click('button:has-text("Export this print")');
  const d = await dl;
  await d.saveAs(`${outDir}/print-${f.replace(/\W+/g, '_')}.jpg`);
  console.log('saved', f);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/mobile.png`, fullPage: false });
await browser.close();
