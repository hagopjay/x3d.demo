// Body style: the layers that make movement read as human, not keyframed.
//  * follow-through: second-order dynamics per joint (t3ssel8r's form), looser
//    and laggier toward the head and hands, crisp at hips/knees/ankles so feet
//    stay planted;
//  * weight transfer: a two-beat side-to-side shift with pelvis tilt, a softer
//    free knee and chest counter-rotation;
//  * head stabilisation: the head partly cancels the spine's tilt (eyes level);
//  * relaxed hands: a resting finger curl derived from the fitted hand geometry.
import { quatFromEuler, eulerZXYFromQuat, vSub, vNorm, vCross, vDot, qRot } from "./math.js";

// f: natural frequency (Hz), z: damping, r: response (r<0 anticipates, r>1 overshoots)
export const SPRINGS = {
  sacroiliac: { f: 4.5, z: 0.85, r: 0.2 },
  vl5: { f: 3.8, z: 0.75, r: 0.1 }, vl1: { f: 3.4, z: 0.7, r: 0.1 }, vt6: { f: 3.0, z: 0.65, r: 0 },
  vc4: { f: 2.6, z: 0.6, r: 0 }, skullbase: { f: 2.2, z: 0.55, r: -0.1 },
  l_sternoclavicular: { f: 3.0, z: 0.6, r: 0 }, r_sternoclavicular: { f: 3.0, z: 0.6, r: 0 },
  l_shoulder: { f: 2.8, z: 0.6, r: 0 }, r_shoulder: { f: 2.8, z: 0.6, r: 0 },
  l_elbow: { f: 2.4, z: 0.5, r: 0 }, r_elbow: { f: 2.4, z: 0.5, r: 0 },
  l_radiocarpal: { f: 2.0, z: 0.45, r: 0 }, r_radiocarpal: { f: 2.0, z: 0.45, r: 0 },
};

class SecondOrder {
  constructor(x0, f, z, r) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / ((2 * Math.PI * f) ** 2);
    this.k3 = (r * z) / (2 * Math.PI * f);
    this.xp = x0.slice(); this.y = x0.slice(); this.yd = [0, 0, 0];
  }
  step(dt, x) {
    if (dt <= 0) return this.y;
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1); // stable at low frame rates
    for (let i = 0; i < 3; i++) {
      const xd = (x[i] - this.xp[i]) / dt;
      this.y[i] += dt * this.yd[i];
      this.yd[i] += (dt * (x[i] + this.k3 * xd - this.y[i] - this.k1 * this.yd[i])) / k2;
    }
    this.xp = x.slice();
    return this.y;
  }
}

export class FollowThrough {
  constructor(scale = 1) { this.s = {}; this.scale = scale; }
  /** With a skeleton, the joint's HAnim limits are inelastic stops: a spring that
   *  overshoots into a stop stays there and loses its outward velocity, as soft
   *  tissue does. Without stops the overshoot rang against the limit and was
   *  clamped every frame (DM14). */
  apply(pose, dt, skeleton = null) {
    for (const [j, p] of Object.entries(SPRINGS)) {
      const x = pose[j] || [0, 0, 0];
      const s = (this.s[j] ||= new SecondOrder(x, p.f * this.scale, p.z, p.r));
      s.step(Math.min(dt, 0.1), x);
      const J = skeleton?.byName?.[j];
      if (J?.llimit) for (let i = 0; i < 3; i++) {
        const lo = (J.llimit[i] * 180) / Math.PI, hi = (J.ulimit[i] * 180) / Math.PI;
        if (s.y[i] > hi) { s.y[i] = hi; if (s.yd[i] > 0) s.yd[i] = 0; }
        else if (s.y[i] < lo) { s.y[i] = lo; if (s.yd[i] < 0) s.yd[i] = 0; }
      }
      pose[j] = s.y.slice();
    }
  }
}

/** Two-beat weight transfer (ph in beats). Returns a pose layer. */
export function weightShift(ph, sway, counter, energy = 0.5, dx = 0.06) {
  const w = Math.cos(Math.PI * ph);          // −1 … 1: weight lands over a foot ON the beat, alternating
  const a = sway * (0.7 + 0.6 * energy);
  const free = Math.max(0, w), free2 = Math.max(0, -w); // which knee unloads (one per beat, alternating)
  return {
    pose: {
      sacroiliac: [0, 7 * w * a * counter, -7 * w * a],
      vl5: [0, 0, 4 * w * a],
      vt6: [0, -6 * w * a * counter, 2.5 * w * a],
      // the free leg peels: knee forward, heel up, toes stay on the floor
      l_knee: [12 * free2 * a, 0, 0], r_knee: [12 * free * a, 0, 0],
      l_hip: [-5 * free2 * a, 0, 0], r_hip: [-5 * free * a, 0, 0],
      l_talocrural: [11 * free2 * a, 0, 0], r_talocrural: [11 * free * a, 0, 0],
    },
    root: [dx * w * a, 0, 0, 0], w: 1, yawW: 0,   // hips travel over the standing foot
  };
}

/** The pocket: knees drop into the floor on every beat, under whatever the
 *  upper body is doing. Additive to the stance (hips and ankles fold with the
 *  knees so the trunk stays upright). d = ((1 + cos 2πφ)/2)^sharp peaks on the beat. */
// depth scale and where the drop lands (beats after the beat). House and funk
// bodies are already up on the beat (the weight transfer straightens the
// standing leg), so their drop goes on the "and"; a drop on the beat would
// cancel it (DM12).
export const POCKET = { hiphop: { depth: 1.25, at: 0 }, house: { depth: 0.85, at: 0.5 }, funk: { depth: 1.0, at: 0.5 } };
export function pocket(ph, depthDeg, at = 0, sharp = 2) {
  const d = ((1 + Math.cos(2 * Math.PI * (ph - at))) / 2) ** sharp * depthDeg;
  return { pose: { l_knee: [d, 0, 0], r_knee: [d, 0, 0], l_hip: [-0.5 * d, 0, 0], r_hip: [-0.5 * d, 0, 0],
                   l_talocrural: [-0.45 * d, 0, 0], r_talocrural: [-0.45 * d, 0, 0], vl5: [0.2 * d, 0, 0] }, root: [0, 0, 0, 0], w: 1, yawW: 0 };
}

/** Keep the eyes roughly level: the head cancels part of the spine's tilt. */
export function stabiliseHead(pose, k = 0.6) {
  let x = 0, z = 0;
  for (const j of ["sacroiliac", "vl5", "vl1", "vt6", "vc4"]) { const v = pose[j]; if (v) { x += v[0]; z += v[2]; } }
  const h = (pose.skullbase ||= [0, 0, 0]);
  h[0] -= x * k * 0.5; h[2] -= z * k;
}

/** Resting finger curl about each hand's knuckle axis, towards the palm. */
export function fingerCurl(skel, amount = 1) {
  const R = skel.rest, out = {};
  if (!R.l_metacarpophalangeal_2) return out;
  for (const s of ["l", "r"]) {
    const across = vNorm(vSub(R[`${s}_metacarpophalangeal_5`], R[`${s}_metacarpophalangeal_2`]));
    const along = vNorm(vSub(R[`${s}_metacarpophalangeal_3`], R[`${s}_radiocarpal`]));
    let palm = vNorm(vCross(across, along));
    const thumb = vSub(R[`${s}_carpal_interphalangeal_1`] || R[`${s}_metacarpophalangeal_1`], R[`${s}_metacarpophalangeal_2`]);
    if (vDot(palm, thumb) < 0) palm = palm.map((v) => -v); // the thumb sits on the palm side
    // choose the rotation sense about `across` that moves a fingertip toward the palm
    const test = (sg) => { const h = Math.sin((sg * 0.3) / 2), q = [across[0] * h, across[1] * h, across[2] * h, Math.cos((sg * 0.3) / 2)]; return vDot(qRot(q, along), palm); };
    const sg = test(1) > test(-1) ? 1 : -1;
    const curl = (deg) => { const a = (sg * deg * Math.PI) / 180 * amount, h = Math.sin(a / 2); return eulerZXYFromQuat([across[0] * h, across[1] * h, across[2] * h, Math.cos(a / 2)]); };
    for (let n = 2; n <= 5; n++) {
      out[`${s}_metacarpophalangeal_${n}`] = curl(12 + 3 * n);
      out[`${s}_carpal_proximal_interphalangeal_${n}`] = curl(22 + 4 * n);
      out[`${s}_carpal_distal_interphalangeal_${n}`] = curl(14 + 2 * n);
    }
    out[`${s}_metacarpophalangeal_1`] = curl(8);
    out[`${s}_carpal_interphalangeal_1`] = curl(12);
  }
  return out;
}
