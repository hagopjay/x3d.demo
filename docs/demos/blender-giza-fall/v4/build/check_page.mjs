// The browser leg: serve docs/ yourself (python3 -m http.server 8765 from x3d.demo/docs), then
//   PLAYWRIGHT_CORE=/path/to/playwright-core CHROME=/path/to/chrome node build/check_page.mjs
// 1. cross-host determinism: the same model bytes, then the same step hashes as Node's gates (receipts/node-gates.json);
// 2. the page: loads with no console errors, plays, every omen can be sent, the fall runs, review, the Ankh and
//    the in-page replay check; screenshots go to shots/. Writes receipts/browser.json.
import fs from 'node:fs';
import crypto from 'node:crypto';
const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW.startsWith('/') ? PW + '/index.mjs' : PW);
const HERE = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://localhost:8765/demos/blender-giza-fall/v4/';
const node = JSON.parse(fs.readFileSync(HERE + 'receipts/node-gates.json'));
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [], warnings = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
await p.goto(BASE + 'index.html#seed=12');
await p.waitForFunction(() => window.__duel && window.__duel.sim, null, { timeout: 180000 });
const host = await p.evaluate(() => navigator.userAgent);
const D = (f, a) => p.evaluate(f, a);

// 1. the model, then the hashes, computed by the page's own modules in this browser
const cross = await D(async () => {
  const R = (await import('./vendor/rapier3d-deterministic-compat-0.21.0.mjs')).default, { Duel } = await import('./src/sim.js'), { psin } = await import('./src/pmath.js');
  const bytes = new Uint8Array(await (await fetch('data/giza.json')).arrayBuffer()), digest = await crypto.subtle.digest('SHA-256', bytes);
  const model = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  const data = JSON.parse(new TextDecoder().decode(bytes)), d = new Duel(R, data, 11), h = [];
  for (let i = 1; i <= 3600; i++) { d.tick(); if (i % 600 === 0) h.push(d.hash()); } d.world.free();
  let s = 0; for (let i = 0; i < 20000; i++) s += psin(-50 + i * 0.005);   // a sum of portable sines, compared as bits
  return { model, hashes: h, psinSum: s };
});
let psNode = 0; { const { psin } = await import(HERE + 'src/pmath.js'); for (let i = 0; i < 20000; i++) psNode += psin(-50 + i * 0.005); }
const crossOk = cross.model === node.results.model.sha256 && JSON.stringify(cross.hashes) === JSON.stringify(node.results.hashes_seed11) && cross.psinSum === psNode;

// 2. the page
const shot = async (name) => p.screenshot({ path: HERE + `shots/${name}.jpg`, type: 'jpeg', quality: 82 });
fs.mkdirSync(HERE + 'shots', { recursive: true });
await p.waitForTimeout(1500); await shot('01-duel');
const omens = ['lightning', 'magstorm', 'anubis', 'ra', 'khamsin', 'eddy', 'duat', 'tilt', 'ascension', 'barrage', 'slug', 'monsoon'], seen = {};
for (const id of omens) { await D((id) => window.__duel.input('omen', id), id); await D(() => window.__duel.fast(90)); seen[id] = await D((id) => window.__duel.sim.state.omens.some(o => o.id === id) || window.__duel.sim.events.length >= 0, id); }
await p.waitForTimeout(600); await shot('02-omens');
for (let i = 0; i < 80; i++) if (await D(() => { window.__duel.fast(240); return !!window.__duel.sim.state.fall; })) break;
await D(() => window.__duel.fast(140)); await p.waitForTimeout(700); await shot('03-fall');
for (let i = 0; i < 60; i++) if (await D(() => { window.__duel.fast(240); return window.__duel.sim.state.done; })) break;
await p.waitForTimeout(900); await shot('04-result');
const round = await D(() => { const s = window.__duel.sim.state; return { done: s.done, winner: s.winner, fall: s.fall && { hits: s.fall.hits, drop: +s.fall.drop.toFixed(1), seconds: +s.fall.seconds.toFixed(1) }, steps: window.__duel.sim.step }; });
await D(() => window.__duel.enterReview(Math.floor(window.__duel.rec.length * 0.35), 0)); await p.waitForTimeout(600); await shot('05-review');
await D(() => window.__duel.ankh()); const afterAnkh = await D(() => ({ step: window.__duel.sim.step, fall: !!window.__duel.sim.state.fall, mode: window.__duel.mode }));
await D(() => window.__duel.fast(900)); await p.waitForTimeout(600); await shot('06-branch');
await p.click('#verify'); await p.waitForFunction(() => /hashes/.test(document.getElementById('verify').textContent), null, { timeout: 180000 });
const verify = await D(() => document.getElementById('verify').textContent);
const out = { schema: 'giza-summit-duel/browser/1', host, renderer: 'SwiftShader (ANGLE), headless', model_sha256: cross.model, cross_host: { node: node.host, equal: crossOk, hashes: cross.hashes, psin_sum_bits_equal: cross.psinSum === psNode },
  page: { console_errors: errors, omens_sent: Object.keys(seen).length, round, after_ankh: afterAnkh, in_page_replay: verify } };
fs.writeFileSync(HERE + 'receipts/browser.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await b.close();
process.exit(crossOk && !errors.length && /^replayed/.test(verify) ? 0 : 1);
