// Writes receipts/duel-seed11.physics.json, a Loom run record (loom.physics-run/1): a 3600-step duel recorded in
// Node with every step's hash, replayed step by step in headless Chromium, the references and controls from
// receipts/node-gates.json, and the loss report of the X3D reader. Judge it with x3d.loom's `kit/loom physics`.
// Needs the docs server (see build/check_page.mjs) and receipts/node-gates.json from `node --test test/`.
import fs from 'node:fs';
import crypto from 'node:crypto';
import R from '../vendor/rapier3d-deterministic-compat-0.21.0.mjs';
import { Duel } from '../src/sim.js';
const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW.startsWith('/') ? PW + '/index.mjs' : PW);
const HERE = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://localhost:8765/demos/blender-giza-fall/v4/';
const STEPS = 3600, SEED = 11, sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gates = JSON.parse(fs.readFileSync(HERE + 'receipts/node-gates.json')), L = JSON.parse(fs.readFileSync(HERE + 'test/limits.json'));
const traps = JSON.parse(fs.readFileSync(HERE + 'receipts/loom-pagetraps.json')), browser = JSON.parse(fs.readFileSync(HERE + 'receipts/browser.json'));
await R.init();
const data = JSON.parse(fs.readFileSync(HERE + 'data/giza.json'));
const d = new Duel(R, data, SEED), hashes = [];
for (let i = 0; i < STEPS; i++) { d.tick(); hashes.push(parseInt(d.hash(), 16)); }
const trace = sha(hashes.join(','));

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.goto(BASE + 'data/giza.json');
const replay = await p.evaluate(async ({ STEPS, SEED, BASE }) => {
  const R = (await import(BASE + 'vendor/rapier3d-deterministic-compat-0.21.0.mjs')).default, { Duel } = await import(BASE + 'src/sim.js'); await R.init();
  const data = await (await fetch(BASE + 'data/giza.json')).json(), d = new Duel(R, data, SEED), h = [];
  for (let i = 0; i < STEPS; i++) { d.tick(); h.push(parseInt(d.hash(), 16)); } return { h, ua: navigator.userAgent };
}, { STEPS, SEED, BASE });
await b.close();
let first = null, mism = 0; replay.h.forEach((x, i) => { if (x !== hashes[i]) { mism++; if (first === null) first = i; } });

const files = ['pmath', 'figure', 'ai', 'omens', 'sim'].map(f => fs.readFileSync(HERE + `src/${f}.js`));
const G = gates.results, ref = (id, observed, limit, extra = {}) => ({ id, observed, limit, declared_limit: limit, status: observed <= limit ? 'pass' : 'fail', ...extra });
const record = {
  schema: 'loom.physics-run/1', id: `giza-summit-duel/seed-${SEED}/recorded-in-node`,
  project: { name: 'x3d.demo/blender-giza-fall/v4 (Summit Duel)', contract: 'giza-summit-duel/0.4' },
  engine: { name: 'Rapier (deterministic build) + Summit Duel sim', version: '0.21.0 + v4', build: 'src/{pmath,figure,ai,omens,sim}.js sha256 ' + sha(Buffer.concat(files)) },
  model: { sha256: G.model.sha256, path: 'data/giza.json', what: 'course heights (v1 generator, re-run), H-Anim joint centres and scene facts read from v3/assets/fall.x3d (sha256 ' + G.model.x3d_sha256 + ')' },
  recorded: { host: 'node', host_version: process.version, fixed_step_s: 1 / 120, steps: STEPS, hashes, trace_sha256: trace },
  replays: [{ host: 'chromium', host_version: replay.ua, steps: replay.h.length, mismatches: mism, first_mismatch: first, engine_version: '0.21.0 + v4', trace_sha256: sha(replay.h.join(',')) }],
  required_hosts: ['chromium'],
  references: [
    ref('portable sine vs Math.sin, max abs over ' + L.psin_args + ' args', G.psin_worst, L.psin_max_abs_vs_Math_sin),
    ref('Lorentz step: turn per step minus (q/m) B dt, rad', G.lorentz.turn_error, L.lorentz_turn_per_step_tolerance_rad),
    ref('Anubis g x 0.35: relative acceleration error', Math.abs(G.anubis['0.35'] + 9.81 * 0.35) / (9.81 * 0.35), L.anubis_accel_relative_tolerance),
    ref('Anubis g x 1.75: relative acceleration error', Math.abs(G.anubis['1.75'] + 9.81 * 1.75) / (9.81 * 1.75), L.anubis_accel_relative_tolerance),
    ref('time eddy entry speed ratio minus 0.25', Math.abs(G.eddy_ratio - 0.25), L.eddy_entry_ratio_tolerance),
    ref('shell landing point error, m', G.shell_landing_error_m, L.shell_landing_tolerance_m),
    ref('standing pelvis height error after 60 s, m (worse duellist)', Math.max(...G.stand.map(h => Math.abs(h - L.stand_pelvis_height_m))), L.stand_pelvis_tolerance_m),
  ],
  tolerances: [],
  controls: [
    { id: 'checkpoint restored without the controllers diverges', expect: 'fail', observed_failed: G.checkpoint.controls_caught >= 1 },
    { id: 'checkpoint restored without the RNG diverges', expect: 'fail', observed_failed: G.checkpoint.controls_caught >= 2 },
    { id: 'explicit-Euler Lorentz step drifts speed past the limit', expect: 'fail', observed_failed: G.lorentz.twin_speed_drift > L.lorentz_speed_drift_tolerance },
    { id: 'sim-nonportable-math trap catches one Math.sin added to src/pmath.js', expect: 'fail', observed_failed: traps.wrong_twin.status === 'fail' },
  ],
  losses: { authored_fields_dropped: 0, reported: true, note: 'The simulation reads no X3D physics fields. The view\'s X3D reader skips HAnimHumanoid (2), Viewpoint (4), lights (2), TimeSensor, 32 interpolators and 64 ROUTEs on purpose and lists them on the page (How it works).' },
  sources: { gates: 'receipts/node-gates.json', browser: 'receipts/browser.json', pagetraps: 'receipts/loom-pagetraps.json' },
  not_shown: ['a second machine', 'Firefox and WebKit', 'a real GPU', 'that the omens are physically right: their strengths are game constants', `browser page check: ${browser.page.in_page_replay}`],
};
fs.mkdirSync(HERE + 'receipts', { recursive: true });
fs.writeFileSync(HERE + `receipts/duel-seed${SEED}.physics.json`, JSON.stringify(record, null, 1));
console.log(`node trace ${trace.slice(0, 16)}, chromium ${mism} of ${STEPS} steps differ (first ${first}), references ${record.references.filter(r => r.status === 'pass').length}/${record.references.length}`);
