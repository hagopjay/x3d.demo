// node test/browser.cjs <site root = the folder that holds demos/> [shots dir]
// Headless Chromium on a software adapter. Checks the page's behaviour, not speed.
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = process.argv[2], shots = process.argv[3] || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.x3d': 'application/xml', '.wasm': 'application/wasm', '.md': 'text/plain', '.toml': 'text/plain', '.yml': 'text/plain' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); }).listen(0);
const results = [];
const ok = (name, cond, extra) => { results.push([name, !!cond, extra === undefined ? '' : extra]); assert(cond, name + ' ' + JSON.stringify(extra)); };
const report = () => results.map(r => (r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[2] !== '' ? '  ' + JSON.stringify(r[2]) : '')).join('\n');
(async () => {
  const port = srv.address().port, base = `http://127.0.0.1:${port}/demos/x3d-trace-viewer/v1/index.html`;
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror ' + e));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  pg.on('requestfailed', r => errs.push('requestfailed ' + r.url()));
  pg.on('response', r => { if (r.status() >= 400) errs.push('http ' + r.status() + ' ' + r.url()); });
  const ready = async () => {
    await pg.waitForFunction(() => window.__traceReady === true, null, { timeout: 30000 });
    await pg.waitForFunction(() => /scene as published|could not/.test(document.getElementById('stagemsg').textContent), null, { timeout: 40000 });
    await pg.waitForTimeout(600);
  };
  const tally = () => pg.evaluate(() => [...document.querySelectorAll('#tally .chip')].map(c => c.textContent.trim()));
  const ovl = (n) => pg.evaluate((n) => {
    const sc = window.__trace.B.currentScene, t = sc.getNamedNode('OVT' + n), s = sc.getNamedNode('OVS' + n);
    return { vis: s.whichChoice, tr: [t.translation.x, t.translation.y, t.translation.z].map(v => +v.toFixed(4)) };
  }, n);
  // 1. load, desktop
  await pg.goto(base); await ready();
  ok('x_ite version shown', /X_ITE 16\.\d+\.\d+/.test(await pg.textContent('#xver')), await pg.textContent('#xver'));
  ok('16 scene claims listed', (await pg.$$('#list li')).length === 16);
  let t = await tally();
  ok('tally default', t[0].includes('11 verified') && t.some(x => x.includes('5 check')), t);
  ok('sha chip ok', /matches the report/.test(await pg.textContent('#sha')));
  // 2. claim 0: left wall
  await pg.click('#list li:nth-child(1) button');
  ok('mark selected = the quote', (await pg.$eval('#code mark.sel', m => m.textContent)) === 'baseColor="0.63 0.065 0.05"');
  let o = await ovl(0);
  ok('box on the left wall', o.vis === 0 && JSON.stringify(o.tr) === JSON.stringify([-2.55, 2.5, 0]), o);
  ok('locus panel names the node', /PhysicalMaterial/.test(await pg.textContent('#locus')));
  // 3. the repeated quote: floor claim, five places
  await pg.click('#list li:nth-child(9) button');
  ok('five places announced', /place 1 of 5/.test(await pg.textContent('#placeno')), await pg.textContent('#placeno'));
  ok('five marks', (await pg.$$('#code mark')).length === 5);
  o = await ovl(0);
  ok('place 1 = floor', JSON.stringify(o.tr) === JSON.stringify([0, -0.05, 0]), o);
  await pg.click('#next'); await pg.click('#next');
  o = await ovl(0);
  ok('place 3 = back wall', JSON.stringify(o.tr) === JSON.stringify([0, 2.5, -2.55]), o);
  await pg.click('#list li:nth-child(11) button');
  o = await ovl(0);
  ok('named node claim boxes the back wall at once', JSON.stringify(o.tr) === JSON.stringify([0, 2.5, -2.55]) && /place 3 of 5/.test(await pg.textContent('#placeno')), o);
  // 4. light: marker, no box
  await pg.click('#list li:nth-child(3) button');
  const mk = await pg.evaluate(() => {
    const sc = window.__trace.B.currentScene, m = sc.getNamedNode('OVTM');
    return { m: sc.getNamedNode('OVSM').whichChoice, b: sc.getNamedNode('OVS0').whichChoice, tr: [m.translation.x, m.translation.y, m.translation.z] };
  });
  ok('light drawn as a marker at its location', mk.m === 0 && mk.b === -1 && mk.tr[1] === 4.6, mk);
  // 5. planted: not found
  await pg.click('#list li:nth-child(15) button');
  ok('invented quote has no mark', (await pg.$$('#code mark')).length === 0 && /not in e2-cornell-box/.test(await pg.textContent('#detail')));
  // 6. strict policy
  await pg.click('input[value=strict]'); await pg.waitForTimeout(200);
  t = await tally();
  ok('tally strict', t[0].includes('9 verified') && t.some(x => x.includes('7 check')), t);
  await pg.click('input[value=default]');
  // 7. edit: intensity 12 -> 120 flips claim 3 live, scene redraws
  await pg.click('#list li:nth-child(3) button');
  await pg.click('#edit');
  await pg.evaluate(() => { const ta = document.querySelector('textarea.code'); ta.value = ta.value.replace('intensity="12"', 'intensity="120"'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(1200);
  const live = await pg.evaluate(() => [...document.querySelectorAll('#list li')].map(li => li.querySelector('.chip').className + '|' + li.querySelector('.chip').textContent));
  ok('claim 3 turns live check', /live/.test(live[2]) && /check/.test(live[2]), live[2]);
  ok('claim 1 stays live verified', /live/.test(live[0]) && /verified/.test(live[0]), live[0]);
  ok('sha chip says edited', /differs/.test(await pg.textContent('#sha')), await pg.textContent('#sha'));
  ok('scene reloaded from the edit', /edited scene/.test(await pg.textContent('#stagemsg')), await pg.textContent('#stagemsg'));
  await pg.click('#reset'); await pg.waitForTimeout(1200);
  t = await tally();
  ok('reset restores the report', t[0].includes('11 verified') && !/live/.test(await pg.$eval('#tally .chip', c => c.className)), t);
  // 8. rig set: coverage
  await pg.click('#tabs .tab:nth-child(2)');
  t = await tally();
  ok('rig tally', t[0].includes('3 verified') && t.some(x => x.includes('5 unchecked')), t);
  ok('rig coverage 3 of 8', /3 of 8/.test(await pg.textContent('#covline')), await pg.textContent('#covline'));
  await pg.click('#list li:nth-child(1) button');
  ok('rig claim marks its line in pins.toml', (await pg.$eval('#code mark.sel', m => m.textContent)) === 'version = "16.7.0"' && /not about the scene/.test(await pg.textContent('#locus')));
  // 9. keyboard
  await pg.focus('#list li:nth-child(1) button'); await pg.keyboard.press('ArrowDown');
  ok('arrow key moves the selection', (await pg.$eval('#list li:nth-child(2) button', b => b.getAttribute('aria-current'))) === 'true');
  // 10. screenshots, desktop and phone
  await pg.click('#tabs .tab:nth-child(1)'); await pg.click('#list li:nth-child(9) button'); await pg.click('#next'); await pg.waitForTimeout(700);
  if (shots) await pg.screenshot({ path: path.join(shots, 'desktop.png') });
  const px = await pg.evaluate(() => { const r = document.querySelector('x3d-canvas').getBoundingClientRect(); return [r.width, r.height]; });
  ok('canvas has a size', px[0] > 300 && px[1] > 250, px);
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(base + '?claim=8'); await m.waitForFunction(() => window.__traceReady === true); await m.waitForTimeout(2500);
  const sw = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok('no horizontal scroll at 390 px', sw[0] <= sw[1], sw);
  if (shots) await m.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
  console.log('all console/http noise:', JSON.stringify(errs));
  const noisy = errs.filter(e => !/font|woff|ERR_ABORTED|favicon/i.test(e));
  ok('no page errors', noisy.length === 0, noisy);
  console.log(report());
  console.log('%d checks, all passed. console noise ignored: %d', results.length, errs.length - noisy.length);
  await b.close(); srv.close();
})().catch(e => { console.log(report()); console.error('FAILED:', e.message); process.exit(1); });
