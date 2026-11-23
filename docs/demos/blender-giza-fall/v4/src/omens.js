// loom:sim
// The omen deck: forces that arrive on the summit at seeded times. Each keeps its state in a plain object (o)
// so checkpoints copy it. Families: electro (electrodynamic), super (supernatural), meta (metaphysical),
// military (artillery and slugs), paint (fun). Numbers are game units, labelled as such on the page.
import { add, sub, mul, len, norm, dot, cross, clamp, clampLen, psin, pcos, PI, qaxis } from './pmath.js';

const H = (sim) => sim.data.khufu.summit_half;
const topY = (sim) => sim.data.khufu.summit;
const parts = (sim, f) => f.order.map(n => [n, f.body(sim, n), f.parts[n]]);
const onSummit = (sim, r) => [sim.rng.range(-H(sim) + r, H(sim) - r), sim.rng.range(-H(sim) + r, H(sim) - r)];

export const OMENS = {
  lightning: {
    name: 'Lightning of Set', family: 'electro', glyph: '⚡', dur: 9,
    line: 'The survey mast is a lightning rod. Whoever stands nearest is struck and charged; like charges repel.',
    start(sim, o) { o.t = 0; o.struck = false; sim.emit('omen-tele', { id: 'lightning', at: 1.4 }); },
    tick(sim, o, dt) {
      o.t += dt;
      if (!o.struck && o.t > 1.4) {
        o.struck = true; const top = [0, sim.data.mast.top, 0];
        const order = sim.figs.map(f => [f, len(sub(f.torsoPos(sim), top))]).sort((a, b) => a[1] - b[1]);
        const struck = [order[0][0]]; if (sim.rng.next() < 0.45) struck.push(order[1][0]);
        const sign = sim.rng.sign();
        struck.forEach((f, i) => {
          const tp = f.torsoPos(sim), out = norm([tp[0], 0, tp[2]]);
          f.knock(sim, 'torso', add(mul(out, 55), [0, 28, 0])); f.s.charge = i === 0 ? sign : sim.rng.sign(); f.s.chargeT = 6;
          sim.emit('strike', { fig: f.idx, from: top, to: f.body(sim, 'head').translation() });
        });
      }
      if (o.struck) {   // Coulomb between the two duellists while charged (game constant k = 900 N m^2)
        const [a, b] = sim.figs; if (a.s.charge && b.s.charge) {
          const pa = a.torsoPos(sim), pb = b.torsoPos(sim), d = sub(pb, pa), r = Math.max(0.8, len(d)), F = clamp(900 * a.s.charge * b.s.charge / (r * r), -260, 260);
          const f = mul(norm(d), F * dt);   // positive F = repulsion: push b away from a
          b.body(sim, 'torso').applyImpulse({ x: f[0], y: f[1], z: f[2] }, true); a.body(sim, 'torso').applyImpulse({ x: -f[0], y: -f[1], z: -f[2] }, true);
          a.unbalance(Math.abs(F) * dt * 0.6); b.unbalance(Math.abs(F) * dt * 0.6);
        }
      }
    },
  },
  magstorm: {
    name: 'Magnetic Storm', family: 'electro', glyph: '🧲', dur: 10,
    line: 'A vertical field bends every paint pellet into a circle (radius m·v / q·B), and an orbiting pole drags at the iron pistols.',
    start(sim, o) { o.t = 0; o.B = sim.rng.sign() * 1.0; sim.state.field.B = o.B; },
    tick(sim, o, dt) {
      o.t += dt; const a = o.t * TAU_6, pole = [4.2 * pcos(a), topY(sim) + 1.6, 4.2 * psin(a)]; o.pole = pole;
      for (const f of sim.figs) { const h = f.body(sim, 'rFore'), t = h.translation(), d = sub(pole, [t.x, t.y, t.z]), r = Math.max(0.9, len(d)), F = mul(norm(d), Math.min(150, 260 / (r * r)) * dt); h.applyImpulse({ x: F[0], y: F[1], z: F[2] }, true); }
    },
    end(sim) { sim.state.field.B = 0; },
  },
  anubis: {
    name: 'Scales of Anubis', family: 'super', glyph: '⚖️', dur: 10,
    line: 'Each heart is weighed. One duellist falls at a third of g, the other at nearly twice it.',
    start(sim, o) { const s = sim.rng.sign(); sim.figs[0].s.grav = s > 0 ? 0.35 : 1.75; sim.figs[1].s.grav = s > 0 ? 1.75 : 0.35; },
    tick() {}, end(sim) { for (const f of sim.figs) f.s.grav = 1; },
  },
  ra: {
    name: 'Eye of Ra', family: 'super', glyph: '☀️', dur: 8,
    line: 'A beam of sunlight sweeps the summit. It slams each duellist once as it passes and dries the paint it crosses.',
    start(sim, o) { const a = sim.rng.range(0, 2 * PI); o.n = [pcos(a), 0, psin(a)]; o.s = -H(sim) - 1; o.speed = (2 * H(sim) + 2) / 8; sim.state.ra = { n: o.n, s: o.s }; sim.emit('omen-tele', { id: 'ra', at: 0 }); },
    tick(sim, o, dt) {
      o.s += o.speed * dt; sim.state.ra = { n: o.n, s: o.s };
      // the beam slams each duellist once as it reaches them (it moves faster than they can be pushed, so it passes)
      o.hit = o.hit || [0, 0];
      sim.figs.forEach((f, i) => { const tp = f.torsoPos(sim), d = tp[0] * o.n[0] + tp[2] * o.n[2] - o.s; if (!o.hit[i] && Math.abs(d) < 0.5 && f.s.mode !== 'fallen') { o.hit[i] = 1; f.knock(sim, 'torso', add(mul(o.n, 70), [0, 25, 0])); sim.emit('sunhit', { fig: i }); } });
      sim.dryTiles((x, z) => Math.abs(x * o.n[0] + z * o.n[2] - o.s) < 0.7);
    },
    end(sim) { sim.state.ra = null; },
  },
  khamsin: {
    name: 'Khamsin', family: 'super', glyph: '🌪️', dur: 12,
    line: 'A desert wind with gusts. Spread-out bodies and pellets catch it; it turns while it blows.',
    start(sim, o) { o.t = 0; o.a0 = sim.rng.range(0, 2 * PI); o.turn = sim.rng.range(-0.25, 0.25); },
    tick(sim, o, dt) {
      o.t += dt; const a = o.a0 + o.turn * o.t, gust = 7 + 5 * psin(o.t * 2.3) * psin(o.t * 0.7 + 1), w = [pcos(a) * gust, 0, psin(a) * gust]; sim.state.field.wind = w; o.w = w;
      for (const f of sim.figs) for (const [n, b, part] of parts(sim, f)) { const F = mul(w, 0.8 * Math.sqrt(part.m) * dt); b.applyImpulse({ x: F[0], y: 0, z: F[2] }, true); }
    },
    end(sim) { sim.state.field.wind = [0, 0, 0]; },
  },
  eddy: {
    name: 'Time Eddy', family: 'meta', glyph: '⌛', dur: 11,
    line: 'A bubble where time runs at a quarter speed: velocities shrink by 4 on the way in, gravity by 16, and grow back on the way out.',
    start(sim, o) { o.t = 0; const [x, z] = onSummit(sim, 2); o.c = [x, topY(sim) + 1, z]; o.r = 2.4; o.v = [sim.rng.range(-0.6, 0.6), 0, sim.rng.range(-0.6, 0.6)]; sim.state.eddy = { c: o.c, r: o.r, s: 0.25 }; },
    tick(sim, o, dt) { o.t += dt; o.c = add(o.c, mul(o.v, dt)); for (const k of [0, 2]) if (Math.abs(o.c[k]) > H(sim) - 1.5) o.v[k] = -o.v[k]; sim.state.eddy.c = o.c; },
    end(sim) { sim.state.eddy = null; sim.releaseEddy(); },
  },
  duat: {
    name: 'Gates of the Duat', family: 'meta', glyph: '🌀', dur: 12,
    line: 'Two gates open on the summit. Walk, fly or shoot into one and come out of the other, with your speed.',
    start(sim, o) {
      const a = onSummit(sim, 1.6); let b = onSummit(sim, 1.6), k = 0; while (len(sub([a[0], 0, a[1]], [b[0], 0, b[1]])) < 6 && k++ < 20) b = onSummit(sim, 1.6);
      o.a = [a[0], topY(sim), a[1]]; o.b = [b[0], topY(sim), b[1]]; o.cd = [0, 0]; sim.state.gates = { a: o.a, b: o.b };
    },
    tick(sim, o, dt) {
      o.cd = o.cd.map(c => c - dt);
      sim.figs.forEach((f, i) => {
        if (o.cd[i] > 0 || f.s.mode === 'fallen') return; const p = f.pelvisPos(sim);
        for (const [from, to] of [[o.a, o.b], [o.b, o.a]]) if (len(sub([p[0], 0, p[2]], [from[0], 0, from[2]])) < 0.75 && p[1] < topY(sim) + 2.5) { sim.teleport(f, sub(to, from)); o.cd[i] = 1.6; sim.emit('teleport', { fig: i, from, to }); break; }
      });
    },
    end(sim) { sim.state.gates = null; },
  },
  tilt: {
    name: 'Benben Tilt', family: 'meta', glyph: '◢', dur: 8,
    line: 'The capstone slab rocks up to 9 degrees about a random axis. Ice paint makes it worse.',
    start(sim, o) { o.t = 0; const a = sim.rng.range(0, 2 * PI); o.axis = [pcos(a), 0, psin(a)]; o.max = sim.rng.range(6, 9) * PI / 180; },
    tick(sim, o, dt) { o.t += dt; const u = o.t / 8, ang = o.max * psin(PI * u) * (u < 0.5 ? 1 : 1) * psin(2 * PI * u * 1.5); sim.setDeck(qaxis(o.axis, ang)); },
    end(sim) { sim.setDeck({ x: 0, y: 0, z: 0, w: 1 }); },
  },
  ascension: {
    name: 'Ascension of the Ba', family: 'super', glyph: '🕊️', dur: 3.2,
    line: 'For 1.8 seconds gravity points up at 3 m/s². Then it remembers.',
    start(sim, o) { o.t = 0; sim.setGravity(3.0); },
    tick(sim, o, dt) { o.t += dt; if (o.t > 1.8 && !o.back) { o.back = true; sim.setGravity(-9.81); } },
    end(sim) { sim.setGravity(-9.81); },
  },
  barrage: {
    name: 'Khafre Battery', family: 'military', glyph: '💥', dur: 9,
    line: 'A battery on Khafre\'s summit, 470 m to the south-west, fires on the duel. Shells take 5.5 s. Watch for the shadow.',
    start(sim, o) { o.t = 0; o.n = 3 + sim.rng.int(3); o.fired = 0; o.next = 0.2; },
    tick(sim, o, dt) {
      o.t += dt; if (o.fired < o.n && o.t >= o.next) {
        const f = sim.rng.pick(sim.figs), p = f.pelvisPos(sim), v = f.body(sim, 'pelvis').linvel();
        const tgt = [clamp(p[0] + v.x * 1.5 + sim.rng.range(-2.2, 2.2), -H(sim) - 2, H(sim) + 2), topY(sim), clamp(p[2] + v.z * 1.5 + sim.rng.range(-2.2, 2.2), -H(sim) - 2, H(sim) + 2)];
        sim.spawnShell(sim.data.khafre_apex.slice(), tgt, 5.5, { R: 6.5, J: 300, kind: 'shell' }); o.fired++; o.next = o.t + sim.rng.range(0.6, 1.6);
      }
    },
  },
  slug: {
    name: 'Orbital Coil Slug', family: 'military', glyph: '🎯', dur: 4,
    line: 'An electromagnetic rail in orbit paints a target for 2.2 s, then drops a tungsten slug at 300 m/s.',
    start(sim, o) { o.t = 0; o.f = sim.rng.int(2); const p = sim.figs[o.f].pelvisPos(sim); o.dot = [p[0], topY(sim), p[2]]; sim.state.laser = o.dot; },
    tick(sim, o, dt) {
      o.t += dt; if (o.t < 2.2) { const p = sim.figs[o.f].pelvisPos(sim); o.dot = add(o.dot, mul(sub([p[0], topY(sim), p[2]], o.dot), Math.min(1, dt * 1.6))); sim.state.laser = o.dot; }
      else if (!o.fired) { o.fired = true; sim.state.laser = null; sim.spawnShell(add(o.dot, [0, 300, 0]), o.dot.slice(), 1.0, { R: 4.2, J: 380, kind: 'slug' }); }
    },
    end(sim) { sim.state.laser = null; },
  },
  monsoon: {
    name: 'Paint Monsoon', family: 'paint', glyph: '🎨', dur: 6,
    line: 'It rains paint balloons. Pink makes you easier to throw, blue is ice, yellow is glue, green makes you light.',
    start(sim, o) { o.t = 0; o.next = 0; },
    tick(sim, o, dt) { o.t += dt; while (o.next <= o.t) { o.next += 0.09; const [x, z] = onSummit(sim, 0.2); sim.spawnPellet([x, topY(sim) + 11 + sim.rng.range(0, 3), z], [sim.rng.range(-0.5, 0.5), -6, sim.rng.range(-0.5, 0.5)], sim.rng.pick(PAINTS), -1, 0.5); } },
  },
};
const TAU_6 = 2 * PI / 6;
export const PAINTS = ['pink', 'blue', 'yellow', 'green'];
export const FAMILIES = { electro: 'Electrodynamic', super: 'Supernatural', meta: 'Metaphysical', military: 'Military', paint: 'Paint' };
export const OMEN_IDS = Object.keys(OMENS);
