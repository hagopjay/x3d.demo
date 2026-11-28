// One dancer: a sense of the beat (BeatMind), a choreographer that picks the
// next move from the vocabulary, and a body that layers move + groove +
// looseness, clamps to HAnimJoint limits and keeps a foot on the floor.
import { BeatMind } from "./beatmind.js";
import { sample, blend } from "./moves.js";
import { rng, wobble } from "./math.js";
import { solveArms, applyReach, FootLock } from "./ik.js";
import { FollowThrough, weightShift, stabiliseHead, fingerCurl, pocket, POCKET } from "./style.js";

const GROOVE_FOR = { house: "jack", hiphop: "bounce", funk: "rock" };
const NOISE_JOINTS = ["vt6", "vl1", "skullbase", "l_shoulder", "r_shoulder", "l_sternoclavicular", "r_sternoclavicular", "sacroiliac"];

export function genreWeights(obs) {
  const b = obs?.bpm || 110, s = obs?.syncopation ?? 0.4;
  const bump = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2);
  const house = bump(b, 124, 7) + 0.3 * bump(b, 62, 4);
  const hiphop = bump(b, 92, 9) + bump(b, 180, 12) * 0.7;
  const funk = bump(b, 108, 8) * (0.6 + s);
  const z = house + hiphop + funk + 1e-6;
  return { house: house / z, hiphop: hiphop / z, funk: funk / z };
}

/** Active fold-back rules by move. Several rules on one move combine: weights
 *  multiply, the tightest scale cap wins. */
export function ruleMap(list) {
  if (!list) return null;
  const m = {};
  for (const r of list.filter((x) => x.active)) {
    const o = (m[r.move] ||= { move: r.move, weight: 1, maxScale: Infinity, from: [] });
    o.weight *= r.weight ?? 1; o.maxScale = Math.min(o.maxScale, r.maxScale ?? Infinity); o.from.push(`${r.witness}@${r.born ?? "?"}`);
  }
  return m;
}

export class Dancer {
  constructor({ name, skeleton, library, genome, seed = 1, side = 1, style = "full", rules = null, features = null }) {
    Object.assign(this, { name, skeleton, library, genome, side, style, rules });
    // feature switches (for one-cause-at-a-time experiments): all on in "full"
    this.feat = { stance: true, sway: true, springs: true, lock: true, head: true, fingers: true, noise: true, pocket: true, ...(features || {}) };
    this.follow = new FollowThrough(genome.spring ?? 1);
    this.footLock = new FootLock();
    this.fingers = fingerCurl(skeleton, 1);
    this.r = rng(seed);
    this.mind = new BeatMind(genome, seed + 17);
    this.noise = Object.fromEntries(NOISE_JOINTS.map((j, i) => [j, [wobble(seed * 31 + i), wobble(seed * 57 + i), wobble(seed * 91 + i)]]));
    this.cur = null; this.prev = null;
    this.history = []; this.barsSinceCheck = 0; this.pendingHit = false; this.queued = null;
    this.metrics = { accents: [], clamps: 0, slide: 0, frames: 0, moves: [] };
    this.lastAccentIdx = -1; this.footRef = null;
  }

  setGenome(g) { this.genome = g; this.mind.g = g; this.follow.scale = g.spring ?? 1; }

  _candidates(obs, partner) {
    const g = this.genome, lib = this.library, gw = genreWeights(obs);
    const energy = (obs?.energy ?? 0.5) * g.energyBias;
    const sync = obs?.syncopation ?? 0.4;
    const prevFam = this.cur?.move.family ?? "groove";
    const beatInBar = this._beatInBar();
    const lost = this.mind.confidence < 0.55;
    const recent = this.history.slice(-8);
    const out = [];
    for (const m of lib.moves) {
      if (lost && !["groove"].includes(m.family)) continue;
      if (m.beats >= 4 && beatInBar !== 0) continue;
      if (m.beats === 2 && beatInBar % 2) continue;
      let w = g.trans[prevFam]?.[m.family] ?? 1;
      w *= 0.15 + m.genres.reduce((s, x) => s + (gw[x] ?? 0), 0);
      w *= Math.exp(-((m.energy - Math.min(1, energy * 1.3)) ** 2) / 0.08);
      w *= Math.max(0.2, 1 + g.syncLove * m.syncopation * (sync - 0.35) * 3);
      w /= 1 + g.novelty * recent.filter((x) => x === m.id).length;
      if (m.family === "hit") w *= this.pendingHit ? 40 * g.hitLove : 0.05;
      if (m.family === "turn") w *= this.pendingHit ? 10 * g.hitLove : 0.6;
      if (m.checkIn) w *= this.barsSinceCheck >= g.checkInBars ? 8 : 0.2;
      if (partner?.cur?.move.checkIn && m.checkIn) w *= 3;
      if (partner?.cur && partner.cur.move.id === m.id && !m.checkIn) w *= 0.5;
      const rule = this.rules?.[m.id];
      if (rule) w *= rule.weight ?? 1;
      if (lost) w = m.id === "sway" ? 3 : m.id === GROOVE_FOR[Object.entries(gw).sort((a, b) => b[1] - a[1])[0][0]] ? 1 : 0.3;
      if (w > 0) out.push([m, w]);
    }
    return out;
  }

  _beatInBar() {
    const p = Math.floor(this.mind.phase + 0.5) - (this.barOffset ?? 0);
    return ((p % 4) + 4) % 4;
  }

  _choose(obs, partner, startBeat) {
    const g = this.genome;
    let move, mirror = this.r() < 0.5, why = "flow";
    if (this.queued) { ({ move, mirror } = this.queued); this.queued = null; why = "echo"; }
    else {
      const c = this._candidates(obs, partner);
      const tot = c.reduce((s, x) => s + x[1], 0);
      let x = this.r() * tot;
      move = c.find(([m, w]) => (x -= w) <= 0)?.[0] ?? this.library.get("sway");
      if (move.checkIn) { mirror = this.side > 0; why = "check-in"; }
      if (move.family === "hit" || move.family === "turn") why = this.pendingHit ? "drop" : why;
    }
    if (!move.mirrorable) mirror = false;
    if (move.checkIn) this.barsSinceCheck = 0;
    if (move.family === "hit" || (this.pendingHit && move.family === "turn")) this.pendingHit = false;
    const slip = this.r() < g.mistakeRate ? 0.5 : 0;
    this.prev = this.cur;
    const cap = this.rules?.[move.id]?.maxScale ?? Infinity;
    this.cur = { move, mirror, startBeat: startBeat + slip, scale: Math.min(cap, g.amplitude * (0.9 + 0.2 * this.r())), why, slip };
    this.history.push(move.id);
    if (this.history.length > 64) this.history.shift();
    this.metrics.moves.push({ id: move.id, mirror, why, slip: !!slip, beat: startBeat });
    return this.cur;
  }

  /** Tell this dancer what the partner just started (for echoes). */
  noticePartner(partnerMove) {
    if (!partnerMove || partnerMove.checkIn || partnerMove.move.family === "groove") return;
    if (this.r() < this.genome.echo && partnerMove.move.mirrorable)
      this.queued = { move: partnerMove.move, mirror: !partnerMove.mirror };
  }

  update(dt, t, obs, partner, events = [], onsets = []) {
    const g = this.genome, mind = this.mind;
    mind.update(dt, t, obs, partner?.mind ?? null);
    for (const e of events) if (e.type === "section") { this.pendingHit = true; mind.startle(0.7); }
    if (obs?.lastDownbeat !== undefined && mind.locked && obs.period) {
      const dbPhase = mind.phase - (t - obs.lastDownbeat) / obs.period; // own phase at the music's downbeat
      this.barOffset = ((Math.round(dbPhase) % 4) + 4) % 4;
    }
    const ph = mind.bodyPhase;
    if (!this.cur) this._choose(obs, partner, Math.floor(ph));
    let started = null;
    while (ph >= this.cur.startBeat + this.cur.move.beats) {
      const end = Math.round(this.cur.startBeat + this.cur.move.beats - this.cur.slip);
      if (this._beatInBar() === 0 && end % 4 === ((this.barOffset ?? 0) % 4)) this.barsSinceCheck++;
      started = this._choose(obs, partner, end);
    }
    if (started && partner) partner.noticePartner(started);

    // ---- body ---------------------------------------------------------------
    const cur = this.cur, lib = this.library;
    const local = ph - cur.startBeat;
    const layers = [];
    const main = sample(lib, cur.move, local, cur.mirror, cur.scale);
    const fade = Math.min(1, Math.max(0, local / 0.3));
    layers.push({ ...main, w: fade, yawW: 1 });
    if (this.prev && fade < 1) {
      const p = sample(lib, this.prev.move, this.prev.move.beats, this.prev.mirror, this.prev.scale);
      layers.push({ ...p, w: 1 - fade, yawW: 0 });
    }
    if (cur.move.family !== "groove") {
      const gw = genreWeights(obs);
      const gid = GROOVE_FOR[Object.entries(gw).sort((a, b) => b[1] - a[1])[0][0]];
      const gm = lib.get(gid);
      const gp = sample(lib, gm, ((ph % 1) + 1) % 1, false, 1);
      layers.push({ ...gp, w: 0.55 * g.bounce * (1 - cur.move.energy * 0.4), yawW: 0 });
    }
    const full = this.style !== "robot";
    // athletic stance: pros never lock their knees; deeper when the music is hot
    const F = this.feat;
    if (full && F.stance) {
      const stance = (12 + 12 * (obs?.energy ?? 0.4) * g.bounce) * (g.stance ?? 1);
      layers.push({ pose: { l_hip: [-stance * 0.5, 0, 0], r_hip: [-stance * 0.5, 0, 0], l_knee: [stance, 0, 0], r_knee: [stance, 0, 0],
        l_talocrural: [-stance * 0.45, 0, 0], r_talocrural: [-stance * 0.45, 0, 0], vl5: [stance * 0.25, 0, 0] }, root: [0, 0, 0, 0], w: 1, yawW: 0 });
    }
    // weight transfer (not during turns/hits, which own the hips)
    if (full && F.sway && !["turn", "hit"].includes(cur.move.family)) layers.push(weightShift(ph, g.sway ?? 0.8, g.counter ?? 0.6, obs?.energy ?? 0.5, F.swayDx ?? 0.03));
    // the pocket: the knees keep dropping on the beat under upper-body moves (DM11)
    if (full && F.pocket && !["groove", "turn", "hit"].includes(cur.move.family)) {
      const gw = genreWeights(obs), genre = Object.entries(gw).sort((a, b) => b[1] - a[1])[0][0];
      const P = POCKET[genre] ?? { depth: 1, at: 0 };
      layers.push(pocket(ph, (F.pocketDeg ?? 9) * g.bounce * P.depth * (1 - 0.4 * cur.move.energy), F.pocketAt?.[genre] ?? P.at));
    }
    const out = blend(layers);
    if (full && F.head) stabiliseHead(out.pose, 0.6);
    if (full && F.fingers) {
      for (const [j, e] of Object.entries(this.fingers)) {
        const v = (out.pose[j] ||= [0, 0, 0]);
        v[0] += e[0]; v[1] += e[1]; v[2] += e[2];
      }
    }
    const conf = mind.confidence;
    if (conf < 0.55) { // still finding it: smaller, head-led
      for (const v of Object.values(out.pose)) { v[0] *= 0.5 + conf; v[1] *= 0.5 + conf; v[2] *= 0.5 + conf; }
      const nod = Math.sin(2 * Math.PI * ph) * 6 * (0.5 + conf);
      (out.pose.skullbase ||= [0, 0, 0])[0] += nod;
    }
    // arms join grooves and footwork
    if (["groove", "step", "footwork", "travel"].includes(cur.move.family) && !Object.keys(main.pose).some((j) => j.endsWith("_elbow"))) {
      const a = g.armStyle, s = Math.sin(2 * Math.PI * ph);
      (out.pose.l_elbow ||= [0, 0, 0])[0] += -55 * a - 10 * s * a;
      (out.pose.r_elbow ||= [0, 0, 0])[0] += -55 * a + 10 * s * a;
      (out.pose.l_shoulder ||= [0, 0, 0])[0] += -12 * s * a; (out.pose.l_shoulder)[2] += 8;
      (out.pose.r_shoulder ||= [0, 0, 0])[0] += 12 * s * a; (out.pose.r_shoulder)[2] -= 8;
    } else {
      (out.pose.l_shoulder ||= [0, 0, 0])[2] += 6; (out.pose.r_shoulder ||= [0, 0, 0])[2] -= 6;
    }
    if (full && F.noise) {
      for (const [j, fns] of Object.entries(this.noise)) {
        const v = (out.pose[j] ||= [0, 0, 0]);
        for (let k = 0; k < 3; k++) v[k] += fns[k](t) * g.looseness;
      }
    }
    // limits: count what the choreography asks for (before dynamics) so the
    // clamps witness still sees impossible moves; the springs then stop at the
    // limits inelastically, and a final clamp is a guard only (not counted)
    this.metrics.clamps += this.skeleton.clampPose(out.pose);
    if (full && F.springs) this.follow.apply(out.pose, dt, this.skeleton); // follow-through: lag and overshoot, distal looser
    this.skeleton.clampPose(out.pose);
    // arm reach (after limits: IK targets are reachable poses by construction)
    if (main.reach && main.reach.w > 0) {
      const w = Math.min(1, main.reach.w) * fade;
      const ik = solveArms(this.skeleton, out.pose, out.root, main.reach);
      applyReach(out.pose, ik, w);
      this.lastReach = { ...main.reach, w };
    } else this.lastReach = null;
    let plant = this.skeleton.plant(out.pose, out.root);
    out.root[1] += plant.dy;
    // foot locking: planted feet stay put while the pelvis shifts over them (not while spinning)
    // a foot is lifted only when the move itself lifts that leg (hip flexed or knee drawn up)
    const lifted = {};
    for (const sd of ["l", "r"]) {
      const h = main.pose[`${sd}_hip`]?.[0] ?? 0, k = main.pose[`${sd}_knee`]?.[0] ?? 0, o = main.pose[`${sd === "l" ? "r" : "l"}_knee`]?.[0] ?? 0;
      lifted[sd] = h < -12 || k - o > 25;
    }
    if (this.footLock.apply(this.skeleton, out.pose, out.root, lifted, full && F.lock && cur.move.family !== "turn", cur.move.family === "travel" ? 0 : (F.homePull ?? 0.5))) {
      plant = this.skeleton.plant(out.pose, out.root);
      out.root[1] += plant.dy;
    }
    // sliding: horizontal motion of the lowest foot while it is planted
    const low = plant.feet.reduce((a, b) => (a.h < b.h ? a : b));
    if (this.footRef && this.footRef.side === low.side) {
      this.metrics.slide += Math.hypot(low.ankle[0] - this.footRef.p[0], low.ankle[2] - this.footRef.p[2]);
    }
    this.footRef = { side: low.side, p: low.ankle };
    this.metrics.frames++;
    // accents: when the body passes an accent of the move, how close is a real onset?
    const accents = cur.move.accents;
    for (let i = 0; i < accents.length; i++) {
      const key = `${cur.startBeat}:${i}`;
      if (local >= accents[i] && this.lastAccentIdx !== key && local - accents[i] < 0.25) {
        this.lastAccentIdx = key;
        let best = 1;
        for (let k = onsets.length - 1; k >= 0 && t - onsets[k].t < 1; k--) best = Math.min(best, Math.abs(onsets[k].t - t));
        this.metrics.accents.push(best);
      }
    }
    return { pose: out.pose, root: out.root, info: { move: cur.move.id, why: cur.why, mirror: cur.mirror, confidence: conf, phase: ph, bar: this._beatInBar() } };
  }

  /** Fitness from what the body did since the last reset (higher is better). */
  score(partner) {
    const m = this.metrics;
    const acc = m.accents.length ? m.accents.reduce((s, d) => s + Math.exp(-((d / 0.045) ** 2)), 0) / m.accents.length : 0;
    const ids = m.moves.map((x) => x.id);
    const counts = {}; ids.forEach((i) => (counts[i] = (counts[i] || 0) + 1));
    const H = -Object.values(counts).reduce((s, c) => s + (c / ids.length) * Math.log(c / ids.length), 0);
    const variety = ids.length ? H / Math.log(Math.max(2, Object.keys(this.library.byId).length)) : 0;
    const slide = m.frames ? m.slide / m.frames : 0;
    const clamps = m.frames ? m.clamps / m.frames : 0;
    const slips = m.moves.filter((x) => x.slip).length / Math.max(1, m.moves.length);
    const res = partner ? Math.cos(2 * Math.PI * (this.mind.phase - partner.mind.phase)) * 0.5 + 0.5 : 0.5;
    const parts = { musicality: acc, variety, slide, clamps, slips, resonance: res, lock: this.mind.confidence };
    const total = 2.0 * acc + 0.8 * variety + 0.5 * res + 0.5 * this.mind.confidence - 40 * slide - 0.2 * clamps - 1.0 * slips;
    return { total, parts };
  }

  resetMetrics() { this.metrics = { accents: [], clamps: 0, slide: 0, frames: 0, moves: [] }; }
}
