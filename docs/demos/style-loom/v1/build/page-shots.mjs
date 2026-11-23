// Whole-page frames and a console check for Demo 75, taken after shots/ is in place.
// Usage: NODE_PATH=$(npm root -g) node build/page-shots.mjs http://127.0.0.1:8765/demos/style-loom/v1/ OUT_DIR
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
const [url, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 1 });
const log = [], bad = [];
page.on('console', m => { if (m.type() === 'error') log.push(m.text()); });
page.on('pageerror', e => log.push('pageerror ' + e.message));
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.STYLELOOM && window.STYLELOOM.ready, null, { timeout: 180000 });
for (const id of ['manuscript', 'neon-noir']) {
  await page.evaluate(id => window.STYLELOOM.pick(id, {}), id);
  await page.waitForFunction(() => !window.STYLELOOM.busy); await page.waitForTimeout(3500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, `page-${id}.png`) });
}
await page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.loading = 'eager'; if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; }); } });
await page.screenshot({ path: path.join(outDir, 'page-full.png'), fullPage: true, timeout: 120000 });
const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => !i.naturalWidth).length);
const rec = { console_errors: log, http_errors: bad, broken_images: imgs, chromium: browser.version() };
fs.writeFileSync(path.join(outDir, 'page-check.json'), JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec));
await browser.close();
