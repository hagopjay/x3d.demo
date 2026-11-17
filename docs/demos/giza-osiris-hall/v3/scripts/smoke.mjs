// Browser smoke test: node scripts/smoke.mjs [--port 8811] [--shots DIR]
// Needs Playwright (npm i -D playwright, or a preinstalled one). Uses software WebGL in CI: a functional check, not a performance one.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('--port', 8811), shots = arg('--shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });
const srv = spawn('python3', ['serve.py', '--port', String(port)], { cwd: root, stdio: 'ignore' });
const results = []; const ok = (name, pass, note = '') => { results.push({ name, pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (note ? '  ' + note : '')); };
let browser;
try {
  await new Promise(r => setTimeout(r, 800));
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'en-US' }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__giza && window.__giza.state, null, { timeout: 90000 });
    ok(`${label}: boots and exposes __giza`, true);
    if (label === 'desktop') {
      for (const k of ['1', '2', '3', '4']) { await page.keyboard.press(k); await page.waitForTimeout(300); const open = await page.evaluate(() => !document.getElementById('modal').hidden && getComputedStyle(document.getElementById('modal')).display !== 'none'); ok(`lens key ${k} opens the source window`, open); await page.keyboard.press('Escape'); }
      const views = await page.evaluate(() => [...document.querySelectorAll('#views button, #nav button')].length); ok('view buttons present', views >= 8, `${views} buttons`);
      const rep = await page.evaluate(async () => { const r = await window.__giza.report(); return { keys: Object.keys(r).length, hash: JSON.stringify(r).includes('sha') }; }); ok('diagnostic report builds with hashes', rep.keys > 3 && rep.hash);
      if (shots) await page.screenshot({ path: path.join(shots, 'desktop.png') });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); ok(`${label}: no horizontal scroll`, !overflow);
    ok(`${label}: no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    if (shots && label === 'phone') await page.screenshot({ path: path.join(shots, 'phone.png') });
    await ctx.close();
  }
} catch (e) { ok('smoke run completed', false, String(e).slice(0, 300)); }
finally { if (browser) await browser.close(); srv.kill(); }
const bad = results.filter(r => !r.pass).length; console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
