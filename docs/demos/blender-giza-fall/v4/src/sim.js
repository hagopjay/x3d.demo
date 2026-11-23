// loom:sim
// Summit Duel: the simulation. Rapier (deterministic build) does contacts and joints; this file owns everything
// else: the pyramid as 202 static courses and a kinematic capstone deck of 144 paintable tiles, two active
// ragdolls, paint pellets and shells integrated here with ray tests, the omen deck, director inputs, the round,
// the fall score, checkpoints (Rapier snapshot + this state + the RNG) and a per-step hash. No DOM, no clock.
import { Figure, G, groups } from './figure.js';
import { think, temperament } from './ai.js';
import { OMENS, OMEN_IDS, PAINTS } from './omens.js';
import { Rng, Hasher, add, sub, mul, len, norm, clamp, qrot, qconj, psin, pcos } from './pmath.js';

export const DT = 1 / 120;
export const TILE_N = 12;
const FRICTION = { stone: 0.6, pink: 0.3, blue: 0.035, yellow: 2.2, green: 0.5, scorch: 0.5 };

export class Duel {
  constructor(R, data, seed, opts = {}) {
    this.R = R; this.data = data; this.seed = seed >>> 0; this.rng = new Rng(this.seed);
    this.bodyOwner = new Map(); this.events = []; this.step = 0;
    this.state = {
      t: 0, done: false, winner: -1, fall: null, omens: [], nextOmen: this.rng.range(4.5, 7.5), chaos: opts.chaos ?? 1,
      families: opts.families || { electro: 1, super: 1, meta: 1, military: 1, paint: 1 }, field: { B: 0, wind: [0, 0, 0] },
      eddy: null, inEddy: {}, gates: null, laser: null, ra: null, tiles: new Array(TILE_N * TILE_N).fill('stone'), gone: [], crumbleT: 0,
      pellets: [], shells: [], debris: [], kmult: 1, deckQ: { x: 0, y: 0, z: 0, w: 1 }, gravity: -9.81, log: [], suddenDeath: false, nextId: 1,
    };
    this.queue = [];
    this.build();
  }
  build() {
    const R = this.R, d = this.data, K = d.khufu;
    const W = this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    W.timestep = DT; W.numSolverIterations = 8;
    const sg = groups(G.STATIC, 0xffff);
    // the courses below the capstone: full square slabs, stacked
    const ground = W.createRigidBody(R.RigidBodyDesc.fixed());
    W.createCollider(R.ColliderDesc.cuboid(1500, 0.5, 1500).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.05).setCollisionGroups(sg), ground);
    let y0 = 0;
    for (let k = 0; k < K.courses - 1; k++) {
      const y1 = K.tops[k], hw = K.half_widths[k];
      W.createCollider(R.ColliderDesc.cuboid(hw, (y1 - y0) / 2, hw).setTranslation(0, (y0 + y1) / 2, 0).setFriction(0.45).setRestitution(0.15).setCollisionGroups(sg), ground);
      y0 = y1;
    }
    W.createCollider(R.ColliderDesc.cylinder((d.mast.top - d.mast.base) / 2, d.mast.radius).setTranslation(0, (d.mast.top + d.mast.base) / 2, 0).setCollisionGroups(sg), ground);
    // the capstone deck: the top course as a kinematic body of 12 x 12 tiles (paint changes a tile's friction)
    const top = K.summit, hh = (top - y0) / 2, H = K.summit_half, tw = (2 * H) / TILE_N;
    this.deckY = y0 + hh; this.tileW = tw; this.summit = top;
    const deck = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, this.deckY, 0));
    this.deckH = deck.handle; this.tileCollider = []; this.colliderTile = new Map();
    for (let i = 0; i < TILE_N; i++) for (let j = 0; j < TILE_N; j++) {
      const x = -H + tw * (i + 0.5), z = -H + tw * (j + 0.5);
      const c = W.createCollider(R.ColliderDesc.cuboid(tw / 2, hh, tw / 2).setTranslation(x, 0, z).setFriction(FRICTION.stone).setRestitution(0.1)
        .setCollisionGroups(groups(G.DECK, 0xffff)), deck);
      this.tileCollider.push(c.handle); this.colliderTile.set(c.handle, i * TILE_N + j);
    }
    // the duellists: v3's colours, the Explorer (orange) and the Pusher (blue), facing each other
    const s = this.rng.range(2.2, 3.4), off = this.rng.range(-1.5, 1.5);
    this.figs = [
      new Figure(this, 0, 'Explorer', [-s, top, off], [1, 0, 0], { color: 'orange' }),
      new Figure(this, 1, 'Pusher', [s, top, -off], [-1, 0, 0], { color: 'blue' }),
    ];
    for (const f of this.figs) f.temper = temperament(this.rng);
  }
  emit(type, d = {}) { this.events.push(Object.assign({ type, step: this.step, t: this.state.t }, d)); }
  input(a, v) { this.queue.push({ a, v }); }
  dangers() {   // [x, y, z, radius] for the AI to avoid
    const out = [], st = this.state;
    for (const s of st.shells) if (s.T - s.t < 3.5) out.push([s.tgt[0], s.tgt[1], s.tgt[2], s.R * 0.8]);
    if (st.laser) out.push([st.laser[0], st.laser[1], st.laser[2], 3.2]);
    return out;
  }

  // ---------- one physics step ----------
  tick() {
    const st = this.state, W = this.world, rng = this.rng;
    this.events.length = 0;
    for (const q of this.queue) this.apply(q.a, q.v, true); this.queue.length = 0;
    // minds every 15 steps (0.125 s)
    // who goes first alternates every step, so neither duellist always acts on fresher information
    const order = this.step & 1 ? [this.figs[1], this.figs[0]] : this.figs;
    if (this.step % 15 === 0) for (const f of (this.step / 15) & 1 ? [this.figs[1], this.figs[0]] : this.figs) think(this, f, this.figs[1 - f.idx]);
    // weapons
    for (const f of order) {
      const s = f.s, foe = this.figs[1 - f.idx];
      if (s.wantFire && s.fireCd <= 0 && s.mag > 0 && s.reload <= 0 && s.mode === 'active') {
        const m = f.muzzle(this), v = add(mul(m.dir, 45), [m.vel.x, m.vel.y, m.vel.z]);
        const paint = PAINTS[rng.int(4)]; this.spawnPellet(m.pos, v, paint, f.idx, 1);
        f.body(this, 'rFore').applyImpulse({ x: -m.dir[0] * 0.8, y: -m.dir[1] * 0.8, z: -m.dir[2] * 0.8 }, true);
        s.mag--; s.fireCd = 0.2 + rng.range(0, 0.3); if (s.mag === 0) s.reload = 1.4;
        this.emit('fire', { fig: f.idx, pos: m.pos, dir: m.dir, paint });
      }
      if (s.shove && s.shoveCd <= 0 && s.mode === 'active') {
        const tq = foe.torsoPos(this);
        for (const h of ['lFore', 'rFore']) {
          const hp = f.muzzle(this).pos, hb = f.body(this, h).translation(), hand = h === 'rFore' ? hp : [hb.x, hb.y - 0.25, hb.z];
          if (len(sub(hand, tq)) < 0.5) {
            const dir = norm([tq[0] - hand[0], 0, tq[2] - hand[2]]), J = foe.knock(this, 'torso', add(mul(dir, 120), [0, 26, 0]));
            foe.knock(this, 'pelvis', mul(dir, 40)); s.shoveCd = 1.5; this.emit('shove', { fig: f.idx, J, at: hand }); break;
          }
        }
      }
    }
    this.omenTick();
    // controllers
    const env = this.env();
    for (const f of this.figs) f.control(this, DT, env);
    this.eddyTick();
    W.step();
    this.pelletTick(); this.shellTick();
    // impacts (sound, and the fall score)
    for (const f of this.figs) for (const [part, J] of f.impacts(this, DT, st.gravity)) {
      if (J < 30 && f.s.mode === 'active') continue;
      const last = f.s.lastHit[part] ?? -99; if (this.step - last < 5) continue;   // one per part per 40 ms, as v1 logged them
      f.s.lastHit[part] = this.step;
      const p = f.body(this, part).translation(); this.emit('impact', { fig: f.idx, part, J, pos: [p.x, p.y, p.z] });
      if (st.fall && st.fall.fig === f.idx && this.step > st.fall.step + 6) { st.fall.hits++; st.fall.hardest = Math.max(st.fall.hardest, J); }
    }
    this.roundTick();
    st.t += DT; this.step++;
  }
  env() {
    const W = this.world, R = this.R, st = this.state, ts2 = {};
    for (const h in st.inEddy) ts2[h] = st.eddy ? st.eddy.s * st.eddy.s : 1;
    return {
      summit: this.summit, gravity: st.gravity, tscale2: ts2,
      ray: (o, d, max) => { const hit = W.castRay(new R.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), max, true, undefined, groups(0xffff, G.STATIC | G.DECK | G.DEBRIS));
        return hit ? { point: add(o, mul(d, hit.timeOfImpact ?? hit.toi)) } : null; },
    };
  }

  // ---------- director inputs (recorded, so a replay of seed + log reproduces the duel) ----------
  apply(a, v, record) {
    const st = this.state; if (record) st.log.push({ step: this.step, a, v });
    if (a === 'omen' && OMENS[v]) this.startOmen(v);
    else if (a === 'chaos') st.chaos = clamp(+v, 0.25, 3);
    else if (a === 'family') st.families[v[0]] = v[1] ? 1 : 0;
    else if (a === 'branch') { this.rng = new Rng((this.rng.u32() ^ (v >>> 0)) >>> 0); }   // the Ankh: same past, a new fate
  }
  startOmen(id) {
    const st = this.state; if (st.omens.some(o => o.id === id)) return;
    const o = { id, t0: st.t, uid: st.nextId++ }; st.omens.push(o); OMENS[id].start(this, o);
    this.emit('omen', { id, name: OMENS[id].name, family: OMENS[id].family });
  }
  omenTick() {
    const st = this.state;
    for (const o of st.omens.slice()) {
      OMENS[o.id].tick(this, o, DT);
      if (st.t - o.t0 >= OMENS[o.id].dur) { OMENS[o.id].end?.(this, o); st.omens.splice(st.omens.indexOf(o), 1); this.emit('omen-end', { id: o.id }); }
    }
    if (st.done || st.fall) return;
    if (st.t >= st.nextOmen && st.omens.length < 2) {
      const pool = OMEN_IDS.filter(id => st.families[OMENS[id].family] && !st.omens.some(o => o.id === id));
      if (pool.length) this.startOmen(this.rng.pick(pool));
      st.nextOmen = st.t + this.rng.range(8, 14) / st.chaos / (st.suddenDeath ? 1.8 : 1);
    }
  }

  // ---------- projectiles ----------
  spawnPellet(p, v, paint, owner, scale = 1) { this.state.pellets.push({ id: this.state.nextId++, p: p.slice(), v: v.slice(), paint, owner, age: 0, k: 1, scale }); }
  pelletTick() {
    const st = this.state, W = this.world, R = this.R, g = st.gravity, keep = [];
    for (const pe of st.pellets) {
      pe.age += DT; if (pe.age > 3.5) continue;
      // forces: gravity (scaled in an eddy), wind, the Lorentz force q v x B (q/m = 6 per field unit: r = v / (6 B))
      const inE = st.eddy && len(sub(pe.p, st.eddy.c)) < st.eddy.r, k = inE ? st.eddy.s : 1;
      if (inE && pe.k === 1) { pe.v = mul(pe.v, k); pe.k = k; } else if (!inE && pe.k !== 1) { pe.v = mul(pe.v, 1 / pe.k); pe.k = 1; }
      // gravity and air (relative to the wind) as forces; the Lorentz force q v x B with a vertical B as an exact
      // rotation of the horizontal velocity by (q/m) B dt per step (q/m = 6 per field unit), so speed is conserved
      let v1 = add(pe.v, mul(add([0, g * k * k, 0], mul(sub(st.field.wind, pe.v), 0.35 * k * k)), DT));
      if (st.field.B) { const th = -6 * st.field.B * k * DT, c = pcos(th), sn = psin(th); v1 = [v1[0] * c - v1[2] * sn, v1[1], v1[0] * sn + v1[2] * c]; }
      const step = mul(v1, DT), L = len(step);
      // the Duat gates carry pellets too
      if (st.gates) for (const [from, to] of [[st.gates.a, st.gates.b], [st.gates.b, st.gates.a]]) if (len(sub([pe.p[0], 0, pe.p[2]], [from[0], 0, from[2]])) < 0.8 && pe.p[1] < from[1] + 2.4 && !pe.ported) { pe.p = add(pe.p, sub(to, from)); pe.ported = true; }
      const filt = pe.owner >= 0 ? (G.STATIC | G.DECK | G.DEBRIS | (pe.owner ? G.FIG0 : G.FIG1)) : 0xffff;
      const hit = L > 1e-9 ? W.castRayAndGetNormal(new R.Ray({ x: pe.p[0], y: pe.p[1], z: pe.p[2] }, { x: step[0] / L, y: step[1] / L, z: step[2] / L }), L, true, undefined, groups(0xffff, filt)) : null;
      if (hit) {
        const toi = hit.timeOfImpact ?? hit.toi, at = add(pe.p, mul(step, toi / L)), n = [hit.normal.x, hit.normal.y, hit.normal.z];
        this.pelletHit(pe, hit.collider, at, n, v1);
        continue;
      }
      pe.p = add(pe.p, step); pe.v = v1; keep.push(pe);
    }
    st.pellets = keep;
  }
  pelletHit(pe, col, at, n, v) {
    const st = this.state, body = col.parent(), owner = body && this.bodyOwner.get(body.handle);
    if (owner) {
      const f = this.figs[owner.fig], dir = norm(v), J = f.knock(this, owner.part, add(mul(dir, 13 * pe.scale), [0, 2.5 * pe.scale, 0]), at);
      if (pe.paint === 'pink') f.s.pink = Math.min(10, f.s.pink + 1);
      else if (pe.paint === 'green') f.s.feather = 4; else if (pe.paint === 'blue') f.s.slipT = 3;
      const bq = body.rotation(), bt = body.translation(), local = qrot(qconj(bq), sub(at, [bt.x, bt.y, bt.z]));
      this.emit('hit', { fig: f.idx, part: owner.part, paint: pe.paint, local, at, J, by: pe.owner });
    } else if (this.colliderTile.has(col.handle)) {
      const i = this.colliderTile.get(col.handle); this.paintTile(i, pe.paint); this.emit('paint', { tile: i, at, paint: pe.paint });
    } else this.emit('splat', { at, n, paint: pe.paint });
  }
  paintTile(i, paint) {
    const st = this.state; if (st.tiles[i] === 'gone') return; st.tiles[i] = paint;
    const c = this.world.getCollider(this.tileCollider[i]), R = this.R;
    c.setFriction(FRICTION[paint]); c.setRestitution(paint === 'green' ? 0.85 : 0.1);
    c.setFrictionCombineRule(paint === 'blue' ? R.CoefficientCombineRule.Min : paint === 'yellow' ? R.CoefficientCombineRule.Max : R.CoefficientCombineRule.Average);
  }
  dryTiles(pred) {
    const H = this.data.khufu.summit_half;
    this.state.tiles.forEach((p, i) => { if (p === 'stone' || p === 'gone') return; const x = -H + this.tileW * (Math.floor(i / TILE_N) + 0.5), z = -H + this.tileW * (i % TILE_N + 0.5); if (pred(x, z)) { this.paintTile(i, 'stone'); this.emit('dry', { tile: i }); } });
  }
  // a shell or slug on an exact drag-free arc, so where it lands is known at launch (the telegraph is honest)
  spawnShell(p0, tgt, T, o) {
    const g = this.state.gravity, v0 = [(tgt[0] - p0[0]) / T, (tgt[1] - p0[1] - 0.5 * g * T * T) / T, (tgt[2] - p0[2]) / T];
    const s = { id: this.state.nextId++, p0, tgt, T, t: 0, v0, g, R: o.R, J: o.J, kind: o.kind }; this.state.shells.push(s);
    this.emit(o.kind === 'slug' ? 'slug' : 'launch', { id: s.id, p0, tgt, T });
  }
  shellPos(s, t) { return [s.p0[0] + s.v0[0] * t, s.p0[1] + s.v0[1] * t + 0.5 * s.g * t * t, s.p0[2] + s.v0[2] * t]; }
  shellTick() {
    const st = this.state, keep = [];
    for (const s of st.shells) { s.t += DT; if (s.t >= s.T) this.blast(s.tgt, s.R, s.J, s.kind); else keep.push(s); }
    st.shells = keep;
  }
  blast(at, R, J, kind) {
    const W = this.world, st = this.state;
    for (const f of this.figs) {
      let total = 0;
      for (const n of f.order) {
        const b = f.body(this, n), t = b.translation(), d = sub([t.x, t.y, t.z], at), r = len(d); if (r > R) continue;
        const fall = (1 - r / R) * (1 - r / R), dir = norm(add(d, [0, 0.7, 0])), Jp = J * fall * f.parts[n].m / f.mass * (1 + 0.35 * f.s.pink) * st.kmult;
        b.applyImpulse({ x: dir[0] * Jp, y: dir[1] * Jp, z: dir[2] * Jp }, true); total += Jp;
      }
      if (total > 0) f.unbalance(total * 1.3);
    }
    for (const h of st.debris) { const b = W.getRigidBody(h); if (!b) continue; const t = b.translation(), d = sub([t.x, t.y, t.z], at), r = len(d); if (r < R) { const dir = norm(add(d, [0, 0.5, 0])), Jp = J * 0.2 * (1 - r / R); b.applyImpulse({ x: dir[0] * Jp, y: dir[1] * Jp, z: dir[2] * Jp }, true); } }
    // limestone chips thrown out of the crater
    for (let i = 0; i < 4; i++) {
      const a = this.rng.range(0, 6.283185307179586), c = this.rng.range(0, 1), dir = [c - 0.5, 1, this.rng.range(-0.5, 0.5)];
      const b = W.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(at[0] + dir[0] * 0.4, at[1] + 0.35, at[2] + dir[2] * 0.4).setLinvel(dir[0] * 9, 6 + c * 6, dir[2] * 9).setCcdEnabled(true));
      W.createCollider(this.R.ColliderDesc.cuboid(0.12, 0.09, 0.11).setMass(18).setFriction(0.6).setRestitution(0.2).setCollisionGroups(groups(G.DEBRIS, 0xffff)), b);
      st.debris.push(b.handle); void a;
    }
    while (st.debris.length > 24) { const h = st.debris.shift(), b = W.getRigidBody(h); if (b) W.removeRigidBody(b); }
    const H = this.data.khufu.summit_half;
    st.tiles.forEach((p, i) => { if (p === 'gone') return; const x = -H + this.tileW * (Math.floor(i / TILE_N) + 0.5), z = -H + this.tileW * (i % TILE_N + 0.5); if (len(sub([x, 0, z], [at[0], 0, at[2]])) < R * 0.35) this.paintTile(i, 'scorch'); });
    this.emit('explode', { at, R, kind });
  }

  // ---------- metaphysics helpers used by omens ----------
  eddyTick() {
    const st = this.state, W = this.world;
    // a figure enters and leaves as one (its pelvis decides), so joints never join slow time to fast time
    const units = this.figs.map(f => [f.parts.pelvis.h, f.order.map(n => f.parts[n].h)]).concat(st.debris.map(h => [h, [h]]));
    for (const [key, hs] of units) {
      const kb = W.getRigidBody(key); if (!kb) continue; const t = kb.translation();
      const inside = !!st.eddy && len(sub([t.x, t.y, t.z], st.eddy.c)) < st.eddy.r, was = !!st.inEddy[key];
      if (inside === was) continue;
      for (const h of hs) { const b = W.getRigidBody(h); if (!b) continue; this.scaleVel(b, inside ? st.eddy.s : 1 / (st.eddy ? st.eddy.s : 0.25)); if (inside) st.inEddy[h] = 1; else delete st.inEddy[h]; }
    }
  }
  releaseEddy() { const s = 0.25; for (const h in this.state.inEddy) { const b = this.world.getRigidBody(+h); if (b) this.scaleVel(b, 1 / s); } this.state.inEddy = {}; for (const pe of this.state.pellets) if (pe.k !== 1) { pe.v = mul(pe.v, 1 / pe.k); pe.k = 1; } }
  scaleVel(b, k) { const v = b.linvel(), w = b.angvel(); b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true); }
  teleport(f, off) { for (const n of f.order) { const b = f.body(this, n), t = b.translation(); b.setTranslation({ x: t.x + off[0], y: t.y + off[1], z: t.z + off[2] }, true); } }
  setDeck(q) { this.state.deckQ = q; this.world.getRigidBody(this.deckH).setNextKinematicRotation(q); }
  setGravity(gy) { this.state.gravity = gy; this.world.gravity = { x: 0, y: gy, z: 0 }; }

  // ---------- the round: fall, rest, Ma'at's judgement ----------
  roundTick() {
    const st = this.state;
    if (!st.fall) {
      const fallen = this.figs.filter(f => f.s.mode === 'fallen');
      if (fallen.length) {
        const f = fallen[0]; st.fall = { fig: f.idx, step: this.step, t: st.t, hits: 0, hardest: 0, peak: 0, still: 0, y0: f.pelvisPos(this)[1] };
        st.winner = fallen.length === 2 ? -1 : 1 - f.idx; this.emit('round-fall', { fig: f.idx, winner: st.winner });
        for (const o of st.omens.slice()) { OMENS[o.id].end?.(this, o); this.emit('omen-end', { id: o.id }); } st.omens = [];
      }
      // Ma'at's judgement: after 50 s, every 5 s, everything hits 20 % harder (up to 6x) and omens come faster
      if (!st.suddenDeath && st.t > 50) { st.suddenDeath = true; st.crumbleT = 0; this.emit('sudden-death'); }
      if (st.suddenDeath) { st.crumbleT -= DT; if (st.crumbleT <= 0) { st.crumbleT = 5; st.kmult = Math.min(6, st.kmult * 1.2); this.emit('kmult', { k: st.kmult }); } }
    } else if (!st.done) {
      if (st.winner >= 0 && this.figs[st.winner].s.mode === 'fallen' && st.t - st.fall.t < 3) { st.winner = -1; this.emit('double-fall'); }
      const f = this.figs[st.fall.fig], v = f.body(this, 'pelvis').linvel(), sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      st.fall.peak = Math.max(st.fall.peak, sp); st.fall.still = sp < 0.5 ? st.fall.still + DT : 0;
      if (st.fall.still > 1.5 || st.t - st.fall.t > 45) {
        const y = f.pelvisPos(this)[1], K = this.data.khufu; st.fall.drop = st.fall.y0 - y;
        st.fall.course = K.tops.findIndex(t => t > y - 0.3) + 1 || K.courses; st.fall.seconds = st.t - st.fall.t;
        st.done = true; this.emit('round-end', { fall: st.fall, winner: st.winner });
      }
    }
  }
  // ---------- determinism: hash, checkpoint, restore ----------
  hash() {
    const h = new Hasher(), W = this.world;
    for (const f of this.figs) for (const n of f.order) { const b = f.body(this, n), t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel(); h.f(t.x).f(t.y).f(t.z).f(r.x).f(r.y).f(r.z).f(r.w).f(v.x).f(v.y).f(v.z).f(w.x).f(w.y).f(w.z); }
    for (const d of this.state.debris) { const b = W.getRigidBody(d); if (b) { const t = b.translation(); h.f(t.x).f(t.y).f(t.z); } }
    for (const p of this.state.pellets) h.f(p.p[0]).f(p.p[1]).f(p.p[2]);
    for (const u of this.rng.state()) h.i(u);
    h.i(this.step);
    return h.hex();
  }
  // the complete state domain: Rapier's world, this state, every controller, the RNG and the step
  checkpoint() {
    return { step: this.step, snap: this.world.takeSnapshot(), state: JSON.stringify(this.state), figs: this.figs.map(f => JSON.stringify(f.s)), rng: this.rng.state() };
  }
  restore(ck, opts = {}) {
    this.world.free(); this.world = this.R.World.restoreSnapshot(ck.snap);
    this.step = ck.step; this.state = JSON.parse(ck.state);
    if (!opts.skipControllers) this.figs.forEach((f, i) => { f.s = JSON.parse(ck.figs[i]); });
    if (!opts.skipRng) this.rng.restore(ck.rng);
    this.events.length = 0; this.queue.length = 0;
  }
  // what the view draws: every moving body's pose
  poses() {
    const out = [];
    for (const f of this.figs) for (const n of f.order) { const b = f.body(this, n), t = b.translation(), r = b.rotation(); out.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w); }
    return out;
  }
}
export { PAINTS };
