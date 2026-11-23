// Gates for Summit Duel. Run from this folder: node --test test/
// Limits come from test/limits.json, written before the suite was first run (Loom PHYSICS-PLAYBOOK pattern 13).
// Each check that could pass by construction has a wrong twin that must fail (law 44, pattern 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import R from '../vendor/rapier3d-deterministic-compat-0.21.0.mjs';
import { Duel, DT } from '../src/sim.js';
import { psin, pcos, len } from '../src/pmath.js';

const HERE = new URL('..', import.meta.url).pathname;
const L = JSON.parse(fs.readFileSync(HERE + 'test/limits.json'));
const data = JSON.parse(fs.readFileSync(HERE + 'data/giza.json'));
await R.init();
const quiet = (d) => { d.state.nextOmen = 1e9; for (const f of d.figs) { f.temper.trigger = 0; f.temper.aggression = 0; f.temper.shoveLust = 0; } return d; };
export const results = {};

test('model: data/giza.json regenerates byte-identical from v1/v3, and names the v3 X3D it read', () => {
  const tmp = '/tmp/giza-duel-extract.json';
  execFileSync('python3', [HERE + 'build/extract.py', '--out', tmp]);
  const a = fs.readFileSync(tmp), b = fs.readFileSync(HERE + 'data/giza.json');
  assert.ok(a.equals(b), 'regenerated data differs');
  const x3d = crypto.createHash('sha256').update(fs.readFileSync(HERE + '../v3/assets/fall.x3d')).digest('hex');
  assert.equal(data.sources.x3d_sha256, x3d);
  assert.equal(data.khufu.tops.length, 203); assert.ok(Math.abs(data.khufu.tops[202] - 138.5) < 1e-6);
  results.model = { sha256: crypto.createHash('sha256').update(b).digest('hex'), x3d_sha256: x3d };
});

test('portable sine: within the limit of Math.sin, and the sim never calls the approximate built-ins', () => {
  let worst = 0; for (let i = 0; i < L.psin_args; i++) { const x = -50 + 100 * i / L.psin_args; worst = Math.max(worst, Math.abs(psin(x) - Math.sin(x)), Math.abs(pcos(x) - Math.cos(x))); }
  assert.ok(worst < L.psin_max_abs_vs_Math_sin, `worst ${worst}`);
  for (const f of ['pmath', 'figure', 'ai', 'omens', 'sim']) {
    const src = fs.readFileSync(HERE + `src/${f}.js`, 'utf8');
    assert.ok(src.startsWith('// loom:sim'), f + ' is not marked // loom:sim');
    assert.ok(!/Math\.(sin|cos|tan|atan2?|exp|pow|log|random)\b/.test(src.replace(/\/\/.*$/gm, '')), f + ' calls a non-portable built-in');
  }
  results.psin_worst = worst;
});

test('standing: two undisturbed duellists stay on their feet for a minute', () => {
  const d = quiet(new Duel(R, data, 3));
  for (let i = 0; i < L.stand_seconds / DT; i++) d.tick();
  for (const f of d.figs) {
    const h = f.pelvisPos(d)[1] - data.khufu.summit;
    assert.equal(f.s.mode, 'active'); assert.ok(Math.abs(h - L.stand_pelvis_height_m) < L.stand_pelvis_tolerance_m, `${f.name} pelvis ${h.toFixed(3)} m`);
  }
  results.stand = d.figs.map(f => +(f.pelvisPos(d)[1] - data.khufu.summit).toFixed(4));
  d.world.free();
});

test('Lorentz: a pellet in the storm turns by (q/m) B dt each step and keeps its speed (no air, no gravity, for the reference)', () => {
  const d = quiet(new Duel(R, data, 4)); d.state.field.B = 1; d.setGravity(0);
  const st = d.state; st.field.wind = [0, 0, 0];
  d.spawnPellet([0, 170, 0], [30, 0, 0], 'pink', 0);
  // air: the pellet loop drags toward the wind at 0.35/s; switch it off for the reference by giving the pellet the wind's speed
  const angles = [], speeds = [];
  for (let i = 0; i < 60; i++) { const v0 = st.pellets[0].v.slice(); st.field.wind = v0.slice(); d.pelletTick(); const v1 = st.pellets[0].v; angles.push(Math.abs(Math.atan2(v0[0] * v1[2] - v0[2] * v1[0], v0[0] * v1[0] + v0[2] * v1[2]))); speeds.push(len(v1)); }
  const want = 6 * 1 * DT, worst = Math.max(...angles.map(a => Math.abs(a - want)));
  assert.ok(worst < L.lorentz_turn_per_step_tolerance_rad, `turn error ${worst}`);
  assert.ok(Math.abs(speeds[59] - 30) / 30 < L.lorentz_speed_drift_tolerance, `speed ${speeds[59]}`);
  // wrong twin: the explicit-Euler Lorentz step this file replaced grows the speed by sqrt(1 + (6 B dt)^2) per step
  let v = [30, 0, 0]; for (let i = 0; i < 60; i++) v = [v[0] - 6 * v[2] * DT, 0, v[2] + 6 * v[0] * DT];
  assert.ok(Math.abs(len(v) - 30) / 30 > L.lorentz_speed_drift_tolerance, 'the wrong twin should fail the speed limit');
  results.lorentz = { turn_error: worst, radius_m: 30 / 6, twin_speed_drift: (len(v) - 30) / 30 };
  d.world.free();
});

test('Scales of Anubis: a limp duellist in the air falls at g times its scale', () => {
  const out = {};
  for (const sc of [0.35, 1.75]) {
    const d = quiet(new Duel(R, data, 5)), f = d.figs[0];
    d.teleport(f, [0, 60, 0]); f.s.mode = 'fallen'; f.s.b = 0; f.s.grav = sc; d.state.fall = { fig: 0, step: 0, t: 0, hits: 0, hardest: 0, peak: 0, still: 0, y0: 0 };
    for (let i = 0; i < 12; i++) d.tick();
    const v0 = f.body(d, 'torso').linvel().y; for (let i = 0; i < 48; i++) d.tick(); const v1 = f.body(d, 'torso').linvel().y;
    const a = (v1 - v0) / (48 * DT), want = -9.81 * sc;
    assert.ok(Math.abs(a - want) / Math.abs(want) < L.anubis_accel_relative_tolerance, `scale ${sc}: ${a.toFixed(3)} vs ${want.toFixed(3)}`);
    out[sc] = +a.toFixed(4); d.world.free();
  }
  results.anubis = out;
});

test('time eddy: a pellet entering the bubble keeps a quarter of its speed', () => {
  const d = quiet(new Duel(R, data, 6)); d.setGravity(0); const st = d.state;
  st.eddy = { c: [0, 170, 0], r: 2, s: 0.25 };
  d.spawnPellet([-3, 170, 0], [20, 0, 0], 'blue', 0);
  let before = 0, after = 0;
  for (let i = 0; i < 40; i++) { const p = st.pellets[0], k0 = p.k, s0 = len(p.v); st.field.wind = p.v.slice(); d.pelletTick(); const q = st.pellets[0]; if (k0 === 1 && q.k !== 1) { before = s0; after = len(q.v); break; } }
  assert.ok(before > 0, 'never entered'); const ratio = after / before;
  assert.ok(Math.abs(ratio - L.eddy_entry_speed_ratio) < L.eddy_entry_ratio_tolerance, `ratio ${ratio}`);
  results.eddy_ratio = ratio; d.world.free();
});

test('shells land exactly where the telegraph says', () => {
  const d = quiet(new Duel(R, data, 7));
  d.spawnShell(data.khafre_apex.slice(), [1.5, data.khufu.summit, -2], 5.5, { R: 6, J: 300, kind: 'shell' });
  const s = d.state.shells[0], p = d.shellPos(s, s.T), err = Math.hypot(p[0] - 1.5, p[1] - data.khufu.summit, p[2] + 2);
  assert.ok(err < L.shell_landing_tolerance_m, `landing error ${err}`);
  let boom = -1; for (let i = 0; i < 700 && boom < 0; i++) { d.tick(); if (d.events.some(e => e.type === 'explode')) boom = d.step; }
  assert.equal(boom, Math.ceil(5.5 / DT - 1e-9));
  results.shell_landing_error_m = err; d.world.free();
});

test('determinism: same seed, same step hashes; another seed differs', () => {
  const run = (seed) => { const d = new Duel(R, data, seed), h = []; for (let i = 1; i <= 3600; i++) { d.tick(); if (i % 600 === 0) h.push(d.hash()); } d.world.free(); return h; };
  const a = run(11), b = run(11), c = run(12);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  results.hashes_seed11 = a;
});

test('checkpoint: restore and continue gives the identical hash; two incomplete restores must not', () => {
  const d = new Duel(R, data, 5); for (let i = 0; i < 2000; i++) d.tick();
  const ck = d.checkpoint(); for (let i = 0; i < L.checkpoint_steps_after; i++) d.tick(); const h = d.hash();
  d.restore(ck); for (let i = 0; i < L.checkpoint_steps_after; i++) d.tick(); assert.equal(d.hash(), h);
  d.restore(ck, { skipControllers: true }); d.figs.forEach(f => { f.s.phase += 0.5; f.s.fireCd = 0; }); for (let i = 0; i < L.checkpoint_steps_after; i++) d.tick();
  const c1 = d.hash() !== h; assert.ok(c1, 'control: controllers not restored should diverge');
  d.restore(ck, { skipRng: true }); d.rng.u32(); for (let i = 0; i < L.checkpoint_steps_after; i++) d.tick();
  const c2 = d.hash() !== h; assert.ok(c2, 'control: RNG not restored should diverge');
  results.checkpoint = { hash: h, snapshot_bytes: ck.snap.length, controls_caught: [c1, c2].filter(Boolean).length };
  d.world.free();
});

test('rounds: every seeded duel ends in a fall within the cap, both sides win, lengths are reasonable', () => {
  const wins = [0, 0, 0], times = [], rows = [];
  for (let s = 1; s <= L.round_seeds; s++) {
    const d = new Duel(R, data, s); while (!d.state.done && d.state.t < L.round_cap_seconds) d.tick();
    assert.ok(d.state.done, `seed ${s} did not end in ${L.round_cap_seconds} s`);
    const f = d.state.fall; wins[d.state.winner + 1]++; times.push(f.t);
    assert.ok(f.drop > L.fall_drop_min_m, `seed ${s}: fall of ${f.drop} m`);
    rows.push({ seed: s, winner: d.state.winner, fall_at_s: +f.t.toFixed(2), drop_m: +f.drop.toFixed(1), hits: f.hits, hardest_Ns: +f.hardest.toFixed(0), peak_ms: +f.peak.toFixed(1), fall_s: +f.seconds.toFixed(1) });
    d.world.free();
  }
  const sorted = times.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  assert.ok(wins[1] >= L.min_wins_each_side && wins[2] >= L.min_wins_each_side, `wins ${wins}`);
  assert.ok(med >= L.median_round_seconds[0] && med <= L.median_round_seconds[1], `median ${med}`);
  results.rounds = { wins: { draw: wins[0], explorer: wins[1], pusher: wins[2] }, median_fall_at_s: +med.toFixed(1), rows };
});

// The suite writes the receipt only when asked (WRITE_RECEIPTS=1), so a plain test run never rewrites tracked
// evidence (Loom failure mode 184). Without it the results go to the temp folder.
test.after(() => { const out = process.env.WRITE_RECEIPTS ? HERE + 'receipts/node-gates.json' : '/tmp/giza-duel-node-gates.json'; fs.mkdirSync(HERE + 'receipts', { recursive: true }); fs.writeFileSync(out, JSON.stringify({ schema: 'giza-summit-duel/gates/1', host: `Node ${process.version} ${process.platform}-${process.arch}`, limits_sha256: crypto.createHash('sha256').update(fs.readFileSync(HERE + 'test/limits.json')).digest('hex'), results }, null, 1)); });
