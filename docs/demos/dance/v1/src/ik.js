// Arm reach: analytic two-bone IK in HAnim space. Targets come from move keys
// (`reach: {l:[x,y,z], r:[x,y,z], w}`) as offsets in the chest frame (vt1).
// The shoulder gets swing + twist so the elbow hinge (−X flexes) lies in the
// arm's bend plane, with the elbow pointing down/back/out like a dancer's.
import { quatFromEuler, qMul, qRot, qConj, vAdd, vSub, vLen, vNorm, vCross, vDot, vScale, qFromFrames, qSlerp, eulerZXYFromQuat, clamp } from "./math.js";

export function solveArms(skel, pose, root, reach) {
  if (!reach || !(reach.w > 0)) return null;
  const need = skel._armNeed ||= new Set(["l", "r"].flatMap((s) => skel.chain(`${s}_radiocarpal`)).concat(skel.chain("vt1")));
  const W = skel.fk(pose, root, need);
  const chest = W.vt1, cP = skel.point(W, "vt1");
  const out = {};
  for (const side of ["l", "r"]) {
    const off = reach[side];
    if (!off) continue;
    const sh = `${side}_shoulder`, el = `${side}_elbow`, wr = `${side}_radiocarpal`;
    const S0 = skel.rest[sh], E0 = skel.rest[el], H0 = skel.rest[wr];
    const L1 = vLen(vSub(E0, S0)), L2 = vLen(vSub(H0, E0));
    const parent = W[skel.byName[sh].parent];
    const S = skel.point(W, sh);
    const T = vAdd(cP, qRot(chest.q, off));
    let dv = vSub(T, S);
    const d = clamp(vLen(dv), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const u = vNorm(dv);
    // pole: down, slightly back and out, in the chest frame
    const sgn = side === "l" ? 1 : -1;
    let pole = qRot(chest.q, vNorm([0.45 * sgn, -1, -0.35]));
    pole = vNorm(vSub(pole, vScale(u, vDot(pole, u))));
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const E = vAdd(vAdd(S, vScale(u, a)), vScale(pole, h));
    const Tc = vAdd(S, vScale(u, d)); // reachable target
    const up1 = vSub(E, S), fore1 = vSub(Tc, E);
    // hinge axis in world: +X of the shoulder frame must be −(upper × fore)
    let hinge = vCross(up1, fore1);
    hinge = vLen(hinge) > 1e-6 ? vScale(vNorm(hinge), -1) : qRot(chest.q, [1, 0, 0]);
    const up0 = vSub(E0, S0), fo0 = vSub(H0, E0);
    // the rest arm's own hinge: normal of its bend plane (≈ +X for straight HAnim arms)
    let x0 = vScale(vCross(up0, fo0), -1);
    x0 = vLen(x0) > 1e-3 * vLen(up0) * vLen(fo0) ? vNorm(x0) : [1, 0, 0];
    if (x0[0] < 0) x0 = vScale(x0, -1);
    const qWorldSh = qFromFrames(up0, x0, up1, hinge); // rest (parent-aligned) frame -> target frame
    const qLocalSh = qMul(qConj(parent.q), qWorldSh);
    // elbow: bring the rest forearm (after the shoulder) onto the target forearm
    const fore0w = qRot(qWorldSh, vSub(H0, E0));
    // signed angle about the hinge (rest arms may already be bent, e.g. fitted bodies)
    const f0 = vNorm(fore0w), f1 = vNorm(fore1);
    const ang = Math.atan2(vDot(vCross(f0, f1), hinge), clamp(vDot(f0, f1), -1, 1));
    const h2 = Math.sin(ang / 2);
    const qLocalEl = [x0[0] * h2, x0[1] * h2, x0[2] * h2, Math.cos(ang / 2)]; // about the rest hinge
    out[sh] = qLocalSh; out[el] = qLocalEl;
  }
  return out;
}

/** Blend IK quaternions into a degree pose by weight w (writes Euler back). */
export function applyReach(pose, ik, w) {
  if (!ik) return;
  for (const [j, q] of Object.entries(ik)) {
    const e = pose[j] || [0, 0, 0];
    const qf = quatFromEuler(e[0], e[1], e[2]);
    pose[j] = eulerZXYFromQuat(qSlerp(qf, q, clamp(w, 0, 1)));
  }
}

// ---- legs: foot locking ----------------------------------------------------
// A planted foot keeps its world position; the leg (hip-knee-ankle) is solved
// so the pelvis can shift and bounce over it. Knee pole: forward (+Z, yawed).
export function solveLeg(skel, pose, root, side, target, footWorld = null) {
  const hip = `${side}_hip`, kn = `${side}_knee`, an = `${side}_talocrural`;
  const need = skel._legNeed?.[side] || ((skel._legNeed ||= {})[side] = new Set(skel.chain(an)));
  const W = skel.fk(pose, root, need);
  const parent = W[skel.byName[hip].parent];
  const S0 = skel.rest[hip], E0 = skel.rest[kn], H0 = skel.rest[an];
  const L1 = vLen(vSub(E0, S0)), L2 = vLen(vSub(H0, E0));
  const S = skel.point(W, hip);
  const d = clamp(vLen(vSub(target, S)), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
  const u = vNorm(vSub(target, S));
  let pole = qRot(parent.q, [0, 0, 1]);
  pole = vNorm(vSub(pole, vScale(u, vDot(pole, u))));
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const E = vAdd(vAdd(S, vScale(u, a)), vScale(pole, h));
  const Tc = vAdd(S, vScale(u, d));
  const up1 = vSub(E, S), fo1 = vSub(Tc, E);
  const up0 = vSub(E0, S0), fo0 = vSub(H0, E0);
  // knee hinge: +X flexes (shin swings back); bend-plane normal = +(thigh × shin)
  let hinge = vCross(up1, fo1);
  hinge = vLen(hinge) > 1e-6 ? vNorm(hinge) : qRot(parent.q, [1, 0, 0]);
  let x0 = vCross(up0, fo0);
  x0 = vLen(x0) > 1e-3 * vLen(up0) * vLen(fo0) ? vNorm(x0) : [1, 0, 0];
  if (x0[0] < 0) x0 = vScale(x0, -1);
  if (vDot(hinge, qRot(parent.q, [1, 0, 0])) < 0) hinge = vScale(hinge, -1);
  const qWorldHip = qFromFrames(up0, x0, up1, hinge);
  const f0 = vNorm(qRot(qWorldHip, fo0)), f1 = vNorm(fo1);
  const ang = Math.atan2(vDot(vCross(f0, f1), hinge), clamp(vDot(f0, f1), -1, 1));
  const hk = Math.sin(ang / 2);
  const qKnee = [x0[0] * hk, x0[1] * hk, x0[2] * hk, Math.cos(ang / 2)];
  const qHipLocal = qMul(qConj(parent.q), qWorldHip);
  // ankle: keep the foot's world orientation as it was before the solve
  const footWorldBefore = footWorld ?? W[an].q;
  const qAnkle = qMul(qConj(qMul(qMul(parent.q, qHipLocal), qKnee)), footWorldBefore);
  pose[hip] = eulerZXYFromQuat(qHipLocal);
  pose[kn] = eulerZXYFromQuat(qKnee);
  pose[an] = eulerZXYFromQuat(qAnkle);
}

/** Per-dancer foot lock: a foot the move does not lift stays on the floor at its
 *  locked spot (IK); a lifted foot is free and re-locks where it lands. */
export class FootLock {
  constructor() { this.lock = { l: null, r: null }; }
  /** homePull: when a lifted foot lands, how far its landing spot is pulled from
   *  where the leg happened to put it back toward its home spot under the body
   *  (0 = land where it is, for travelling moves). Without it the free foot
   *  followed each hip shift outward and locked there, so the stance ratcheted
   *  wider every step until the hips could no longer get over a foot (DM15). */
  apply(skel, pose, root, lifted = { l: false, r: false }, enabled = true, homePull = 0.5) {
    if (!enabled) { this.lock = { l: null, r: null }; return 0; }
    let W = skel.fk(pose, root);
    // if a grounded foot is out of reach, the pelvis sinks (a body bends, it doesn't float)
    let drop = 0;
    for (const s of ["l", "r"]) {
      if (lifted[s]) continue;
      const an = `${s}_talocrural`, hip = `${s}_hip`, restY = skel.rest[an][1];
      const L = skel._legLen?.[s] ?? ((skel._legLen ||= {})[s] = vLen(vSub(skel.rest[`${s}_knee`], skel.rest[hip])) + vLen(vSub(skel.rest[an], skel.rest[`${s}_knee`])));
      const H = skel.point(W, hip), lk = this.lock[s] ?? [skel.point(W, an)[0], skel.point(W, an)[2]];
      const dx = H[0] - lk[0], dz = H[2] - lk[1], reach = 0.985 * L;
      const need = H[1] - restY - Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
      drop = Math.max(drop, need);
    }
    if (drop > 0) { root[1] -= drop; W = skel.fk(pose, root); }
    let solved = 0;
    for (const s of ["l", "r"]) {
      const an = `${s}_talocrural`, p = skel.point(W, an), restY = skel.rest[an][1];
      if (lifted[s]) { this.lock[s] = null; continue; }
      if (!this.lock[s]) {
        const yaw = ((root[3] || 0) * Math.PI) / 180, r = skel.rest[an];
        const home = [r[0] * Math.cos(yaw) + r[2] * Math.sin(yaw), -r[0] * Math.sin(yaw) + r[2] * Math.cos(yaw)];
        this.lock[s] = [p[0] + homePull * (home[0] - p[0]), p[2] + homePull * (home[1] - p[2])];
      }
      const tgt = [this.lock[s][0], restY, this.lock[s][1]];
      // a grounded foot lies flat, turned only with the body (root yaw)
      const flat = quatFromEuler(0, root[3] || 0, 0);
      solveLeg(skel, pose, root, s, tgt, flat); solved++;
    }
    return solved;
  }
}
