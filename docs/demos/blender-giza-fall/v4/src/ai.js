// loom:sim
// The CPU duellists. Each has a seeded temperament; it thinks every 0.125 s: keep a preferred range, circle,
// stay off the edges and out of telegraphed danger, aim with its own error, shoot, and shove when the other
// one is close, staggered or near an edge. Shooting comes out of the real (wobbling) forearm, so aim is physical.
import { add, sub, mul, len, norm, dot, clamp, cross } from './pmath.js';

export function temperament(rng) {
  return { aggression: rng.range(0.35, 1), accuracy: rng.range(0.015, 0.07), range: rng.range(2.6, 6.2), circle: rng.sign(),
    trigger: rng.range(0.28, 0.6), shoveLust: rng.range(0.3, 1), nerve: rng.range(0.4, 1) };
}

export function think(sim, me, foe) {
  const s = me.s, t = me.temper, rng = sim.rng, H = sim.data.khufu.summit_half;
  if (s.mode === 'fallen' || foe.s.mode === 'fallen') { s.vdes = [0, 0, 0]; s.aim = null; s.shove = false; s.celebrate = s.mode !== 'fallen'; return; }
  const p = me.pelvisPos(sim), q = foe.torsoPos(sim), d = sub([q[0], 0, q[2]], [p[0], 0, p[2]]), dist = len(d), dn = dist > 1e-6 ? mul(d, 1 / dist) : [0, 0, 1];
  s.face = dn;
  // where to stand: preferred range, circling, a nudge toward the foe when aggressive
  const tang = mul(cross([0, 1, 0], dn), t.circle);
  let want = add(mul(dn, clamp((dist - t.range) * 0.9, -1.5, 1.8)), mul(tang, 0.9));
  // shove: close, and the foe is wobbly or near an edge
  const foeP = foe.pelvisPos(sim), foeEdge = H - Math.max(Math.abs(foeP[0]), Math.abs(foeP[2]));
  // a rush: every few seconds an aggressive duellist closes in to shove, more eagerly when the foe wobbles or is near a rim
  if (s.rushT > 0) s.rushT -= 0.125; else if (rng.next() < 0.02 * t.aggression * (1 + 3 * (1 - foe.s.b) + (foeEdge < 2 ? 2 : 0))) s.rushT = rng.range(1.5, 3.5);
  const shoveTime = (dist < 2.2 && (foe.s.b < 0.7 || foeEdge < 1.8 || rng.next() < 0.05 * t.shoveLust)) || s.rushT > 0;
  s.shove = shoveTime && s.mode === 'active';
  if (s.shove) want = add(mul(dn, dist > 0.9 ? 2.4 : 0.6), mul(tang, 0.3));
  // edges: a repulsion that grows inside 2.8 m of the rim, weighted by nerve, and a gentle pull to the middle
  for (const [ax, sg] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
    const gap = H - sg * p[ax]; if (gap < 2.8) { const push = (2.8 - gap) * (1.2 + 1.6 * t.nerve); if (ax === 0) want[0] -= sg * push; else want[2] -= sg * push; }
  }
  const rc = len([p[0], 0, p[2]]); if (rc > 3) want = add(want, mul([p[0], 0, p[2]], -0.25 * (rc - 3) / rc));
  // the sun beam: step back from the side it is coming from
  if (sim.state.ra) { const r = sim.state.ra, dd = p[0] * r.n[0] + p[2] * r.n[2] - r.s; if (dd > -0.5 && dd < 2.5) want = add(want, mul(r.n, 1.2)); }
  // telegraphed danger: shells, slugs and the sun beam
  for (const z of sim.dangers()) { const dz = sub([p[0], 0, p[2]], [z[0], 0, z[2]]), dd = len(dz); if (dd < z[3]) want = add(want, mul(norm(dz), (z[3] - dd) * 1.4)); }
  // the mast is in the way
  const dm = len([p[0], 0, p[2]]); if (dm < 1.0) want = add(want, mul(norm([p[0], 0, p[2]]), 1.2));
  const sp = len(want); s.vdes = sp > 2.2 ? mul(want, 2.2 / sp) : want;
  // aim: the foe's chest, led by its velocity, plus the duellist's own error
  const fv = foe.body(sim, 'torso').linvel(), mz = me.muzzle(sim), tof = dist / 45;
  const err = [rng.range(-1, 1) * t.accuracy * dist, rng.range(-1, 1) * t.accuracy * dist, rng.range(-1, 1) * t.accuracy * dist];
  s.aim = add(add(q, mul([fv.x, fv.y, fv.z], tof)), add(err, [0, 0.05 + 4.9 * tof * tof, 0]));
  if (s.shove) s.aim = q;
  // trigger: when the barrel really points at the aim point
  const toAim = norm(sub(s.aim, mz.pos)), ok = dot(toAim, mz.dir) > 1 - 0.05 / (0.4 + t.aggression);
  s.wantFire = !s.shove && ok && s.mode === 'active' && s.b > 0.45 && rng.next() < t.trigger + 0.3 * t.aggression;
}
