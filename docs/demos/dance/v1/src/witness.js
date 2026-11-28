// Movement witnesses (Loom style): each reads a tape of what a dancer did and
// reports {witness, value, limit, status, grade:"C", instrument, saw}. Limits
// live in dance/limits.json and are committed before a training run.
// A witness that saw nothing says so (status "not_run"), never "pass".
import { quatFromEuler, qRot } from "./math.js";

export class Tape {
  constructor(skeleton, name) { this.sk = skeleton; this.name = name; this.f = []; }
  push(t, out, obs, move) {
    this.f.push({ t, pose: JSON.parse(JSON.stringify(out.pose)), root: out.root.slice(), move,
                  beat: obs && obs.period ? { lastBeat: obs.lastBeat, period: obs.period } : null, phase: out.info?.phase });
  }
}

const MAJOR = ["sacroiliac", "vl5", "vt6", "skullbase", "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_hip", "r_hip", "l_knee", "r_knee"];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

export function track(tape) {
  const sk = tape.sk, pts = { pel: [], lw: [], rw: [], la: [], ra: [], lt: [], rt: [], chest: [], com: [], head: [] };
  for (const fr of tape.f) {
    const W = sk.fk(fr.pose, fr.root);
    const P = (j) => sk.point(W, j);
    const pel = P("sacroiliac"), chest = P("vt6"), head = P("skullbase");
    // spine joints sit at the back of the body: the trunk's mass is ~8 cm in front of them
    const fwd = (j, d) => { const q = W[j].q, v = qRot(q, [0, 0, d]); const p0 = P(j); return [p0[0] + v[0], p0[1] + v[1], p0[2] + v[2]]; };
    const pelM = fwd("sacroiliac", 0.08), chestM = fwd("vt6", 0.09);
    const up = (j) => qRot(W[j].q, [0, 1, 0]);
    pts.tilt = pts.tilt || { pel: [], chest: [], head: [] };
    pts.tilt.pel.push(up("sacroiliac")); pts.tilt.chest.push(up("vt6")); pts.tilt.head.push(up("skullbase"));
    const lw = P("l_radiocarpal"), rw = P("r_radiocarpal");
    const la = P("l_talocrural"), ra = P("r_talocrural"), lk = P("l_knee"), rk = P("r_knee");
    const lt = P(sk.feet[0].toe), rt = P(sk.feet[1].toe);
    // crude centre of mass: segment-mass-weighted key points (Dempster-like shares)
    const parts = [[pelM, 0.30], [chestM, 0.25], [head, 0.08], [lk, 0.10], [rk, 0.10], [la, 0.04], [ra, 0.04], [lw, 0.045], [rw, 0.045]];
    const tot = parts.reduce((s, p) => s + p[1], 0);
    const com = [0, 1, 2].map((i) => parts.reduce((s, [p, w]) => s + p[i] * w, 0) / tot);
    pts.pel.push(pel); pts.lw.push(lw); pts.rw.push(rw); pts.la.push(la); pts.ra.push(ra); pts.lt.push(lt); pts.rt.push(rt); pts.chest.push(chest); pts.com.push(com); pts.head.push(head);
  }
  return pts;
}

function hull(points) { // 2D convex hull (x,z)
  const p = points.map((q) => [q[0], q[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function distToHull(pt, H) { // <=0 inside
  if (H.length < 3) return Math.hypot(pt[0] - (H[0]?.[0] ?? 0), pt[1] - (H[0]?.[1] ?? 0));
  let inside = true, best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const cr = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    if (cr < 0) inside = false;
    const ab = [b[0] - a[0], b[1] - a[1]], ap = [pt[0] - a[0], pt[1] - a[1]];
    const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
    best = Math.min(best, Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1]));
  }
  return inside ? -best : best;
}

export function witness(tape, limits, { partner = null, dancer = null } = {}) {
  const f = tape.f, n = f.length, out = [];
  const R = (witness, value, cmp, limit, saw, extra = {}) => {
    if (!saw) return out.push({ witness, status: "not_run", value: null, limit, grade: "C", reason: "saw nothing", ...extra });
    const ok = cmp === ">=" ? value >= limit : value <= limit;
    out.push({ witness, status: ok ? "pass" : "fail", value: +value.toFixed(4), cmp, limit, grade: "C", saw, ...extra });
  };
  if (n < 30) { R("tape", 0, ">=", 30, 0); return out; }
  const dt = (f[n - 1].t - f[0].t) / (n - 1);
  const P = track(tape);
  // 1 groove: vertical pelvis oscillation (cm) and mean knee flexion (deg)
  const py = P.pel.map((p) => p[1]);
  const amp = (pct(py, 0.95) - pct(py, 0.05)) / 2 * 100;
  R("groove.bounce_cm", amp, ">=", limits.groove_bounce_cm, n, { instrument: "FK pelvis height p95-p5/2" });
  const knee = f.reduce((s, fr) => s + ((fr.pose.l_knee?.[0] ?? 0) + (fr.pose.r_knee?.[0] ?? 0)) / 2, 0) / n;
  R("groove.knee_deg", knee, ">=", limits.groove_knee_deg, n, { instrument: "mean knee flexion" });
  // 2 musicality: how much of the pelvis bounce sits at the music's beat rate,
  // in phase with the heard beat (projection onto e^{-i2πφ(t)}; 1 = pure beat-locked bounce)
  const mean = py.reduce((a, b) => a + b, 0) / n;
  let cx = 0, cy = 0, e2 = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const b = f[i].beat; if (!b) continue;
    const y = py[i] - mean, ph = (f[i].t - b.lastBeat) / b.period;
    cx += y * Math.cos(2 * Math.PI * ph); cy += y * Math.sin(2 * Math.PI * ph); e2 += y * y; cnt++;
  }
  const conc = cnt ? Math.SQRT2 * Math.hypot(cx, cy) / Math.sqrt(cnt * e2 || 1) : 0;
  const meanPh = Math.atan2(cy, cx) / (2 * Math.PI);
  R("musicality.bounce_on_beat", conc, ">=", limits.musicality_conc, cnt,
    { instrument: "beat-rate spectral concentration of pelvis height", offset_beats: +(((meanPh + 1.5) % 1) - 0.5).toFixed(3) });
  // 3 smoothness: RMS jerk of the wrists (m/s^3), finite differences on the tape
  const jerk = (arr) => { const v = []; for (let i = 3; i < arr.length; i++) { let s = 0; for (let k = 0; k < 3; k++) { const j = (arr[i][k] - 3 * arr[i - 1][k] + 3 * arr[i - 2][k] - arr[i - 3][k]) / dt ** 3; s += j * j; } v.push(Math.sqrt(s)); } return pct(v, 0.5); };
  const wj = (jerk(P.lw) + jerk(P.rw)) / 2;
  R("smoothness.wrist_jerk_median", wj, "<=", limits.smooth_wrist_jerk_median, n, { instrument: "median |3rd difference| of FK wrist position (hits are allowed to be sudden)", gate: false });
  // 4 involvement: share of major joints that actually move (RMS angular speed > 10 deg/s)
  let moving = 0;
  for (const j of MAJOR) {
    let s = 0;
    for (let i = 1; i < n; i++) { const a = f[i].pose[j] || [0, 0, 0], b = f[i - 1].pose[j] || [0, 0, 0]; s += ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / dt ** 2; }
    if (Math.sqrt(s / (n - 1)) > 10) moving++;
  }
  R("involvement.joints_moving", moving / MAJOR.length, ">=", limits.involvement, n, { instrument: "RMS angular speed > 10 deg/s over 12 major joints", gate: false });
  // 4b lockstep: robotic motion stops every joint together at each key
  // (move-hold-move); human motion keeps something moving
  let stops = 0;
  for (let i = 1; i < n; i++) {
    let still = 0;
    for (const j of MAJOR) { const a = f[i].pose[j] || [0, 0, 0], b = f[i - 1].pose[j] || [0, 0, 0]; if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / dt < 5) still++; }
    if (still / MAJOR.length >= 0.7) stops++;
  }
  R("overlap.lockstep_stops", stops / (n - 1), "<=", limits.lockstep_stop_share, n, { instrument: "share of frames where >=70% of 12 major joints are still (<5 deg/s)" });
  // 5 balance: centre of mass over the support (feet hull + margin)
  let over = 0;
  const restA = { l: tape.sk.rest.l_talocrural[1], r: tape.sk.rest.r_talocrural[1] };
  const restT = { l: tape.sk.rest[tape.sk.feet[0].toe][1], r: tape.sk.rest[tape.sk.feet[1].toe][1] };
  for (let i = 0; i < n; i++) {
    const foot = (A, T) => [A, T, [A[0], A[1], A[2] - 0.07]];
    const planted = [];
    if (P.la[i][1] < restA.l + 0.03) planted.push(...foot(P.la[i], P.lt[i]));
    else if (P.lt[i][1] < restT.l + 0.015) planted.push(P.lt[i]);       // heel up, toes down: still support
    if (P.ra[i][1] < restA.r + 0.03) planted.push(...foot(P.ra[i], P.rt[i]));
    else if (P.rt[i][1] < restT.r + 0.015) planted.push(P.rt[i]);
    const sup = planted.length ? planted : [...foot(P.la[i], P.lt[i]), ...foot(P.ra[i], P.rt[i])];
    if (distToHull([P.com[i][0], P.com[i][2]], hull(sup)) <= limits.balance_margin_m) over++;
  }
  R("balance.com_supported", over / n, ">=", limits.balance_share, n, { instrument: "crude CoM vs support hull + margin" });
  // 6 contact: planted-foot slide and wrists inside the torso
  let slide = 0, sc = 0, inside = 0;
  for (let i = 1; i < n; i++) {
    for (const [A, T] of [[P.la, P.lt], [P.ra, P.rt]]) {
      if (A[i][1] < pct(A.map((p) => p[1]), 0.2) + 0.01 && A[i - 1][1] < pct(A.map((p) => p[1]), 0.2) + 0.01) { slide += Math.hypot(A[i][0] - A[i - 1][0], A[i][2] - A[i - 1][2]); sc++; }
    }
    for (const W of [P.lw[i], P.rw[i]]) {
      const a = P.pel[i], b = P.chest[i];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [W[0] - a[0], W[1] - a[1], W[2] - a[2]];
      const u = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
      if (u > 0 && u < 1) { const d = Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]); if (d < limits.torso_radius_m) inside++; }
    }
  }
  R("contact.foot_slide_mm", sc ? (slide / sc) * 1000 : 0, "<=", limits.slide_mm_per_frame, sc, { instrument: "planted ankle xz travel per frame" });
  R("contact.hands_in_torso", inside / (2 * n), "<=", limits.hands_in_torso_share, n, { instrument: "wrist within torso radius of pelvis-chest axis" });
  // 7 limits (from the dancer's own counter)
  if (dancer) R("limits.clamps_per_frame", dancer.metrics.clamps / Math.max(1, dancer.metrics.frames), "<=", limits.clamps_per_frame, dancer.metrics.frames, { instrument: "HAnimJoint llimit/ulimit clamps" });
  // 8 partner: phase coherence of the two bodies' beat senses over the tape
  if (partner) {
    let px = 0, pyy = 0, c = 0;
    for (let i = 0; i < Math.min(n, partner.f.length); i++) { const d = (f[i].phase ?? 0) - (partner.f[i].phase ?? 0); px += Math.cos(2 * Math.PI * d); pyy += Math.sin(2 * Math.PI * d); c++; }
    R("partner.phase_coherence", Math.hypot(px, pyy) / Math.max(1, c), ">=", limits.partner_R, c, { instrument: "circular resultant of beat-phase difference" });
  }
  // 9 variety: move entropy and longest repeat streak
  const moves = []; for (const fr of f) if (moves[moves.length - 1] !== fr.move) moves.push(fr.move);
  const mc = {}; moves.forEach((m) => (mc[m] = (mc[m] || 0) + 1));
  const H = -Object.values(mc).reduce((s, c) => s + (c / moves.length) * Math.log(c / moves.length), 0) / Math.log(Math.max(2, moves.length));
  R("variety.entropy", H, ">=", limits.variety_entropy, moves.length, { instrument: "normalised entropy of move changes" });
  return out;
}

/** Scalar fitness from witness reports: passes count, margins refine. */
export function fitnessFrom(reports, weights = {}) {
  let s = 0;
  for (const r of reports) {
    if (r.status === "not_run") continue;
    const w = weights[r.witness] ?? 1;
    const margin = r.cmp === ">=" ? (r.value - r.limit) / (Math.abs(r.limit) || 1) : (r.limit - r.value) / (Math.abs(r.limit) || 1);
    s += w * ((r.status === "pass" ? 1 : 0) + 0.25 * Math.max(-1, Math.min(1, margin)));
  }
  return s;
}

/** Attribute frame-level failures to the move being danced (fold-back input). */
export function attribute(tape, limits) {
  const f = tape.f, n = f.length, P = track(tape), by = {};
  const restA = { l: tape.sk.rest.l_talocrural[1], r: tape.sk.rest.r_talocrural[1] };
  const restT = { l: tape.sk.rest[tape.sk.feet[0].toe][1], r: tape.sk.rest[tape.sk.feet[1].toe][1] };
  for (let i = 1; i < n; i++) {
    const m = (by[f[i].move] ||= { frames: 0, balance: 0, slide: 0, hands: 0 });
    m.frames++;
    const foot = (A, T) => [A, T, [A[0], A[1], A[2] - 0.07]];
    const sup = [];
    if (P.la[i][1] < restA.l + 0.03) sup.push(...foot(P.la[i], P.lt[i])); else if (P.lt[i][1] < restT.l + 0.015) sup.push(P.lt[i]);
    if (P.ra[i][1] < restA.r + 0.03) sup.push(...foot(P.ra[i], P.rt[i])); else if (P.rt[i][1] < restT.r + 0.015) sup.push(P.rt[i]);
    if (distToHull([P.com[i][0], P.com[i][2]], hull(sup.length ? sup : [...foot(P.la[i], P.lt[i]), ...foot(P.ra[i], P.rt[i])])) > limits.balance_margin_m) m.balance++;
    for (const A of [P.la, P.ra]) if (A[i][1] < A[i - 1][1] + 0.002 && A[i][1] < Math.min(restA.l, restA.r) + 0.01 && Math.hypot(A[i][0] - A[i - 1][0], A[i][2] - A[i - 1][2]) * 1000 > limits.slide_mm_per_frame) m.slide++;
    for (const W of [P.lw[i], P.rw[i]]) {
      const a = P.pel[i], b = P.chest[i], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [W[0] - a[0], W[1] - a[1], W[2] - a[2]];
      const u = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
      if (u > 0 && u < 1 && Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]) < limits.torso_radius_m) m.hands++;
    }
  }
  return by;
}
