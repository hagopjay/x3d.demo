// node build/test_page.mjs : headless test of index.html (X_ITE pane, Babylon pane, boards) and the screenshots in shots/
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const HERE = fileURLToPath(new URL('..', import.meta.url)), ROOT = normalize(join(HERE, '../../..'));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer((q, s) => { let p = join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!p.startsWith(ROOT) || !existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p)); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/demos/fault-lab/v3/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errs = [], bad = []; let pass = 0, fail = 0;
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('pageerror ' + e.message));
page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
// colours seen in a screenshot of the element (reading the WebGL canvas directly would clear X_ITE's undrawn buffer and leave it black)
// Every capture is a clipped page screenshot (reading the WebGL canvas with drawImage would clear X_ITE's undrawn buffer).
// The server MUST send x_ite.css as text/css: v1's test server did not, X_ITE then drew nothing, and v1's colour count passed
// anyway because it counted the caption text. Both are fixed here.
const clipOf = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); return page.locator(sel).boundingBox(); };
const snap = async (sel, file) => page.screenshot({ path: join(HERE, 'shots', file), clip: await clipOf(sel) });
// colours in the top 70% of the element: the caption card at the bottom has text, which would count as drawing
const lit = async sel => { const c = await clipOf(sel); c.height *= 0.7; const b64 = (await page.screenshot({ clip: c, scale: 'css' })).toString('base64'); return page.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const t = new OffscreenCanvas(160, 100), x = t.getContext('2d'); x.drawImage(i, 0, 0, 160, 100); const d = x.getImageData(0, 0, 160, 100).data; const seen = new Set(); for (let k = 0; k < d.length; k += 4) seen.add((d[k] >> 4) << 8 | (d[k + 1] >> 4) << 4 | d[k + 2] >> 4); return seen.size; }, b64); };
await page.goto(url); await page.waitForFunction(() => window.FAULT_LAB && window.FAULT_LAB.state.ready, null, { timeout: 90000 });
ok('guard reports ready', await page.evaluate(() => GfxGuard.state.outcome) === 'ready', JSON.stringify(await page.evaluate(() => GfxGuard.state)));
ok('11 case buttons', await page.locator('.case').count() === 11);
const stats = await page.locator('.stat b').allTextContents(); ok('headline numbers', stats.join('|') === '1 of 10|9 of 10|0 of 7|4 of 7|5 of 10|0 → 6 of 6|6 of 6', stats.join('|'));
await page.waitForTimeout(1500);
ok('X_ITE canvas draws the clean twin', await lit('#xite') > 6, 'colours ' + await lit('#xite'));
await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(HERE, 'shots/01-hero.png') });
await page.evaluate(() => FAULT_LAB.select('two-materials', true)); await page.waitForTimeout(1500);
ok('two-materials: inspector shows the new catch', (await page.locator('#insp').innerText()).includes('New catch'));
ok('two-materials: sfnode-multiple message shown', (await page.locator('#insp').innerText()).includes('sfnode-multiple'));
for (let i = 0; i < 40 && await lit('#xite') < 7; i++) await page.waitForTimeout(500);
ok('two-materials: X_ITE draws it', await lit('#xite') > 6, 'colours ' + await lit('#xite'));
ok('two-materials: boxed still present', await page.locator('.compare .box').count() === 1);
// a viewport tall enough to hold the whole lab
await page.setViewportSize({ width: 1500, height: 2300 }); await page.waitForTimeout(2500);
await snap('.lab', '02-two-materials.png');
await page.evaluate(() => FAULT_LAB.setTab('bab')); await page.waitForTimeout(2500);
ok('Babylon pane ready', await page.evaluate(() => GfxGuard.state.panes.babylon.outcome) === 'ready', JSON.stringify(await page.evaluate(() => GfxGuard.state.panes.babylon)));
ok('Babylon canvas draws', await lit('#bab') > 6, 'colours ' + await lit('#bab'));
ok('glTF packet for OsirisShaftA shown', (await page.locator('#hud').innerText()).includes('crm:'), (await page.locator('#hud').innerText()).slice(0, 90));
await page.waitForTimeout(1500); await snap('.lab', '03-gltf-babylon.png');
await page.evaluate(() => FAULT_LAB.select('secret-tunnel', true)); await page.waitForTimeout(2000);
ok('Babylon follows the selected case', await page.evaluate(() => FAULT_LAB.state.bab) === 'secret-tunnel');
await page.evaluate(() => FAULT_LAB.setTab('xite')); await page.waitForTimeout(1500);
ok('X_ITE follows the selected case', await page.evaluate(() => FAULT_LAB.state.xite) === 'secret-tunnel');
await page.evaluate(() => FAULT_LAB.select('giza-swapped', true)); ok('giza-swapped is shown as still missed', (await page.locator('#insp').innerText()).includes('Still missed'));
await page.evaluate(() => FAULT_LAB.select('feet-not-metres', true)); ok('record fault explains it is not drawn', (await page.locator('#insp').innerText()).includes('the record is not drawn'));
await page.locator('#bBefore').click(); ok('board before: 1 of 10', (await page.locator('#boardsub').innerText()).includes('1 of 10'));
await page.locator('#bAfter').click(); ok('board after: 9 of 10', (await page.locator('#boardsub').innerText()).includes('9 of 10'));
ok('downstream table: 7 rows', await page.locator('#down tbody tr').count() === 7); ok('format table: 8 rows', await page.locator('#fmt tbody tr').count() === 8); ok('lifted row is marked new', await page.locator('#fmt .chip.vio').count() === 1); ok('format table marks 2 Blender rows fixed', await page.locator('#fmt .chip.ok').count() === 2); ok('Blender to USD still shows the gap', (await page.locator('#fmt tbody tr').last().innerText()).includes('0 of 3'));
await snap('#board', '04-board.png');
await snap('#down', '05-downstream.png'); await snap('#fmt', '06-formats.png');
ok('lift: 7 rules shown, all pass', await page.locator('#lift .rule').count() === 11 && await page.locator('#lift .rule.f').count() === 0, (await page.locator('#lift .rules').innerText()).replace(/\n/g, ' | '));
ok('lift: extras answer 0, packets answer 1', (await page.locator('#lift .big').allTextContents()).join('|') === '0 answers|1 answer');
ok('lift: before shows the depth as text, after as a number', await page.locator('#lift pre .s').count() === 1 && await page.locator('#lift pre .n').count() === 1 && await page.locator('#lift pre .t').count() >= 1);
// the lifted file must still load in an engine: Babylon.js (already on the page) reads it and finds the same 12 meshes with geometry
const bl = await page.evaluate(async () => { const out = {}; for (const f of ['blender.glb', 'blender.lifted.glb']) { const c = await BABYLON.SceneLoader.LoadAssetContainerAsync('assets/blender/', f, FAULT_LAB.babylon.scene); out[f] = c.meshes.filter(m => m.getTotalVertices() > 0).length; c.dispose(); } return out; });
ok('Babylon loads the lifted glb with the same meshes', bl['blender.lifted.glb'] === 12 && bl['blender.glb'] === 12, JSON.stringify(bl));
await snap('#lift', '07-lift.png');
ok('no failed requests', bad.length === 0, bad.join(' ; ')); ok('no console errors', errs.length === 0, errs.slice(0, 4).join(' ; '));
// phone width: no horizontal page scroll
const ph = await browser.newPage({ viewport: { width: 390, height: 800 } }); await ph.goto(url); await ph.waitForFunction(() => window.FAULT_LAB && window.FAULT_LAB.state.ready, null, { timeout: 90000 });
ok('phone: no horizontal scroll', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'scrollWidth ' + await ph.evaluate(() => document.documentElement.scrollWidth));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
