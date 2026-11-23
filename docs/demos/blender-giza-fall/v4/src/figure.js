// loom:sim
// An active H-Anim ragdoll: 11 Rapier bodies placed at the joint centres read from v3's fall.x3d (Explorer skeleton),
// with joint motors written by hand (PD torques in quaternion error form) that hold a pose, plus "puppet strings":
// an upright torque on pelvis and torso and a support force under the pelvis while a foot can reach the ground.
// Balance b in [0,1] scales all of it. Hits lower b; at b < 0.12 the body goes limp; a fall below the summit
// makes it limp for good. Everything the controller remembers lives in plain fields so a checkpoint can copy it.
import { qmul, qconj, qrot, qerr, qyaw, qfromTo, qaxis, qid, qnorm, add, sub, mul, dot, len, norm, clampLen, clamp, psin } from './pmath.js';

export const G = { STATIC: 0x0001, DECK: 0x0002, FIG0: 0x0004, FIG1: 0x0008, DEBRIS: 0x0010 };
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

// part: [name, kind, centre(rest, figure-local, from joints), size, mass, parent, joint-at, joint kind]
function partsFrom(J) {
  const c = (n) => J[n].center, y = (n) => J[n].center[1];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const P = [
    ['pelvis', 'box', [0, 0.93, 0], [0.16, 0.11, 0.11], 13, null],
    ['torso', 'box', [0, 1.24, 0], [0.19, 0.22, 0.125], 26, 'pelvis', c('vl5'), 'ball'],
    ['head', 'ball', [0, 1.69, 0.01], [0.13], 5, 'torso', c('skullbase'), 'ball'],
  ];
  for (const s of ['l', 'r']) {
    const hip = c(s + '_hip'), knee = c(s + '_knee'), ank = c(s + '_ankle'), sh = c(s + '_shoulder'), el = c(s + '_elbow'), wr = c(s + '_wrist');
    P.push([s + 'Thigh', 'cap', mid(hip, knee), [y(s + '_hip') - y(s + '_knee'), 0.075], 9.5, 'pelvis', hip, 'ball']);
    P.push([s + 'Shin', 'cap', mid(knee, [ank[0], ank[1] - 0.02, ank[2]]), [y(s + '_knee') - ank[1] + 0.02, 0.06], 4.5, s + 'Thigh', knee, 'knee']);
    P.push([s + 'Upper', 'cap', [sh[0], (sh[1] + el[1]) / 2, sh[2]], [sh[1] - el[1], 0.055], 2.3, 'torso', sh, 'ball']);
    P.push([s + 'Fore', 'cap', [el[0], (el[1] + wr[1] - 0.1) / 2, el[2]], [el[1] - wr[1] + 0.1, 0.045], 1.7, s + 'Upper', el, 'elbow']);
  }
  return P;
}

export class Figure {
  constructor(sim, idx, name, pos, facing, opts = {}) {
    const R = sim.R, W = sim.world;
    this.idx = idx; this.name = name; this.color = opts.color;
    this.group = idx ? G.FIG1 : G.FIG0;
    const cg = groups(this.group, G.STATIC | G.DECK | G.DEBRIS | (idx ? G.FIG0 : G.FIG1));
    const q0 = qyaw(facing);
    this.parts = {}; this.order = []; this.mass = 0;
    for (const [n, kind, ctr, size, m, parent, at, jk] of partsFrom(sim.data.skeleton)) {
      const p = add(pos, qrot(q0, ctr));
      const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p[0], p[1], p[2]).setRotation(q0)
        .setLinearDamping(0.04).setAngularDamping(0.25).setCcdEnabled(true));
      let cd;
      if (kind === 'box') cd = R.ColliderDesc.cuboid(size[0], size[1], size[2]);
      else if (kind === 'ball') cd = R.ColliderDesc.ball(size[0]);
      else cd = R.ColliderDesc.capsule(Math.max(0.02, size[0] / 2 - size[1]), size[1]);
      W.createCollider(cd.setMass(m).setFriction(0.45).setRestitution(0.15).setCollisionGroups(cg), body);
      let halfLen = kind === 'cap' ? size[0] / 2 : kind === 'box' ? size[1] : size[0];
      if (n.endsWith('Shin')) {   // a foot: a box at the bottom of the shin, toes forward (+Z)
        W.createCollider(R.ColliderDesc.cuboid(0.05, 0.035, 0.115).setTranslation(0, -size[0] / 2 + 0.02, 0.05).setMass(0.9)
          .setFriction(0.9).setRestitution(0.05).setCollisionGroups(cg), body);
      }
      // inertia estimate for the PD gains (slender rod or box about a transverse axis)
      const L = kind === 'cap' ? size[0] : kind === 'box' ? 2 * size[1] : 2 * size[0];
      const I = m * (L * L) / 12 + m * 0.01;
      this.parts[n] = { name: n, h: body.handle, m, I, parent, halfLen, kind, size: size.slice() };
      this.order.push(n); this.mass += m;
      sim.bodyOwner.set(body.handle, { fig: idx, part: n });
      if (parent) {
        const pb = W.getRigidBody(this.parts[parent].h), pc = add(pos, qrot(q0, partsFrom(sim.data.skeleton).find(x => x[0] === parent)[2]));
        const jw = add(pos, qrot(q0, at));
        const a1 = qrot(qconj(q0), sub(jw, pc)), a2 = qrot(qconj(q0), sub(jw, p));
        let jd;
        if (jk === 'ball') jd = R.JointData.spherical({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] });
        else {
          jd = R.JointData.revolute({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: 1, y: 0, z: 0 });
          jd.limitsEnabled = true; jd.limits = jk === 'knee' ? [0, 2.4] : [-2.4, 0];
        }
        const j = W.createImpulseJoint(jd, pb, body, true); j.setContactsEnabled(false);
      }
    }
    // controller state (all plain numbers: a checkpoint copies this object)
    this.s = { mode: 'active', b: 1, limpT: 0, phase: 0, face: norm([facing[0], 0, facing[2]]), vdes: [0, 0, 0], aim: null, shove: false,
      shoveCd: 0, fireCd: 1.0, mag: 8, reload: 0, pink: 0, feather: 0, charge: 0, chargeT: 0, grav: 1, celebrate: false, fallenAt: -1,
      grounded: false, stand: 0.9, lastV: {}, lastHit: {}, rushT: 0, hits: 0, hardest: 0, slipT: 0 };
  }
  body(sim, n) { return sim.world.getRigidBody(this.parts[n].h); }
  pelvisPos(sim) { const t = this.body(sim, 'pelvis').translation(); return [t.x, t.y, t.z]; }
  torsoPos(sim) { const t = this.body(sim, 'torso').translation(); return [t.x, t.y, t.z]; }
  // knock: an impulse into one part (world N*s) with paint multiplying it; balance drops with the total
  knock(sim, part, J, at) {
    const mult = (1 + 0.35 * this.s.pink) * (sim.state.kmult || 1), Jm = mul(J, mult), b = this.body(sim, part);
    if (at) b.applyImpulseAtPoint({ x: Jm[0], y: Jm[1], z: Jm[2] }, { x: at[0], y: at[1], z: at[2] }, true);
    else b.applyImpulse({ x: Jm[0], y: Jm[1], z: Jm[2] }, true);
    this.unbalance(len(Jm));
    return len(Jm);
  }
  unbalance(J) { if (this.s.mode === 'fallen') return; this.s.b -= 0.45 * J / this.mass; if (this.s.b < 0.12 && this.s.mode !== 'limp') { this.s.mode = 'limp'; this.s.limpT = 0.9 + Math.min(2.2, J / 120); this.s.b = 0; } }

  // one controller step: dt is the physics step; env gives ground query, gravity and per-body time scale
  control(sim, dt, env) {
    const s = this.s, W = sim.world, P = this.parts;
    const pel = this.body(sim, 'pelvis'), tor = this.body(sim, 'torso');
    const pp = pel.translation(), up = qrot(tor.rotation(), [0, 1, 0]);
    // ---- state machine ----
    if (s.mode !== 'fallen' && pp.y < env.summit - 1.6) { s.mode = 'fallen'; s.b = 0; s.fallenAt = sim.step; sim.emit('fall', { fig: this.idx }); }
    if (s.mode === 'limp') { s.limpT -= dt; s.b = 0; if (s.limpT <= 0) s.mode = 'rise'; }
    else if (s.mode === 'rise') { s.b = Math.min(1, s.b + 0.75 * dt); if (s.b > 0.65 && up[1] > 0.8) s.mode = 'active'; }
    else if (s.mode === 'active') {
      if (up[1] < 0.55) s.b -= 1.4 * dt; else if (s.grounded) s.b = Math.min(1, s.b + 0.45 * dt);
      if (s.b < 0.12) { s.mode = 'limp'; s.limpT = 1.0; s.b = 0; }
    }
    s.shoveCd -= dt; s.fireCd -= dt; if (s.reload > 0) { s.reload -= dt; if (s.reload <= 0) s.mag = 8; }
    if (s.feather > 0) s.feather -= dt; if (s.chargeT > 0) { s.chargeT -= dt; if (s.chargeT <= 0) s.charge = 0; }
    if (s.slipT > 0) s.slipT -= dt;
    const b = s.b, gscale = env.gravity < 0 ? s.grav * (s.feather > 0 ? 0.6 : 1) : 0;
    for (const n of this.order) this.body(sim, n).setGravityScale(s.grav * (s.feather > 0 ? 0.6 : 1) * (env.tscale2[P[n].h] ?? 1), false);
    // ---- ground probe and support (the puppet string) ----
    const hit = env.ray([pp.x, pp.y, pp.z], [0, -1, 0], 1.35);
    s.grounded = !!hit && s.mode !== 'fallen';
    const tsP = env.tscale2[P.pelvis.h] ?? 1;   // inside a time eddy every force runs at s^2
    if (s.grounded && b > 0 && gscale > 0) {
      const target = hit.point[1] + s.stand, v = pel.linvel();
      const F = tsP * clamp(b * (this.mass * -env.gravity * gscale + 2600 * (target - pp.y) - 380 * v.y / Math.sqrt(tsP)), 0, 2.2 * this.mass * 9.81);
      pel.applyImpulse({ x: 0, y: F * 0.7 * dt, z: 0 }, true); tor.applyImpulse({ x: 0, y: F * 0.3 * dt, z: 0 }, true);
      // walking: drive the pelvis toward the wanted velocity
      const vd = mul(s.vdes, Math.sqrt(tsP)), dv = [vd[0] - v.x, 0, vd[2] - v.z], Fh = clampLen(mul(dv, this.mass * 7 * b * Math.sqrt(tsP)), (s.slipT > 0 ? 120 : 520) * tsP);
      pel.applyImpulse({ x: Fh[0] * 0.6 * dt, y: 0, z: Fh[2] * 0.6 * dt }, true); tor.applyImpulse({ x: Fh[0] * 0.4 * dt, y: 0, z: Fh[2] * 0.4 * dt }, true);
      s.phase += dt * (2 + 7 * Math.min(1, len(s.vdes) / 2.2));
    }
    // ---- target pose ----
    const yaw = qyaw(s.face), sp = len(s.vdes);
    const lean = sp > 0.1 ? qaxis(norm(qrot(yaw, [1, 0, 0])), 0.12 * Math.min(1, sp / 2)) : qid();
    const T = {};
    T.pelvis = qmul(lean, yaw); T.torso = T.pelvis; T.head = yaw;
    const sw = s.grounded ? 0.55 * Math.min(1, sp / 2.2) : 0, ph = s.phase;
    const xAxis = qrot(yaw, [1, 0, 0]);
    T.lThigh = qmul(qaxis(xAxis, -sw * psin(ph)), yaw); T.rThigh = qmul(qaxis(xAxis, sw * psin(ph)), yaw);
    T.lShin = qmul(qaxis(xAxis, 0.15 + sw * Math.max(0, psin(ph + 1.2))), T.lThigh); T.rShin = qmul(qaxis(xAxis, 0.15 + sw * Math.max(0, -psin(ph + 1.2))), T.rThigh);
    const down = [0, -1, 0], armTo = (shoulder, dir) => qmul(qfromTo(down, norm(dir)), qid());
    const shL = this.body(sim, 'lUpper').translation(), shR = this.body(sim, 'rUpper').translation();
    if (s.celebrate) {
      T.lUpper = armTo(0, add([0, 1, 0], mul(qrot(yaw, [0.5, 0, 0]), 1))); T.rUpper = armTo(0, add([0, 1, 0], mul(qrot(yaw, [-0.5, 0, 0]), 1)));
      T.lFore = T.lUpper; T.rFore = T.rUpper;
    } else if (s.shove && s.aim) {
      const t = s.aim; T.lUpper = armTo(0, sub(t, [shL.x, shL.y, shL.z])); T.rUpper = armTo(0, sub(t, [shR.x, shR.y, shR.z])); T.lFore = T.lUpper; T.rFore = T.rUpper;
    } else {
      T.rUpper = s.aim ? armTo(0, sub(s.aim, [shR.x, shR.y, shR.z])) : qmul(qaxis(qrot(yaw, [0, 0, 1]), -0.2), yaw);
      T.rFore = T.rUpper;
      const flail = s.mode === 'rise' || (s.mode === 'active' && b < 0.6);
      T.lUpper = flail ? qmul(qaxis(xAxis, ph * 2.2), yaw) : qmul(qaxis(qrot(yaw, [0, 0, 1]), 0.25), yaw);
      T.lFore = qmul(qaxis(xAxis, -0.5), T.lUpper);
    }
    // ---- PD torques ----
    const strength = s.mode === 'fallen' ? 0.04 : s.mode === 'limp' ? 0.06 : Math.max(b, 0.25);
    for (const n of this.order) {
      const part = P[n], body = this.body(sim, n), q = body.rotation(), w = body.angvel(), ts2 = env.tscale2[part.h] ?? 1;
      const e = qerr(T[n], q);
      if (!part.parent) continue;
      const pb = this.body(sim, part.parent), pw = pb.angvel();
      const wn = n === 'head' ? 14 : n === 'torso' ? 16 : 20, k = part.I * wn * wn * strength * ts2, d = 2 * part.I * wn * 0.9 * Math.max(strength, 0.1) * ts2;
      let tq = sub(mul(e, k), mul([w.x - pw.x, w.y - pw.y, w.z - pw.z], d));
      tq = clampLen(tq, part.m * 40);
      body.applyTorqueImpulse({ x: tq[0] * dt, y: tq[1] * dt, z: tq[2] * dt }, true);
      pb.applyTorqueImpulse({ x: -tq[0] * dt, y: -tq[1] * dt, z: -tq[2] * dt }, true);
    }
    // upright: external torques on pelvis and torso (the second string), only while balanced
    if (b > 0) for (const n of ['pelvis', 'torso']) {
      const part = P[n], body = this.body(sim, n), w = body.angvel(), wn = 15, ts2 = env.tscale2[part.h] ?? 1;
      const e = qerr(T[n], body.rotation()), I = part.I * 1.6;
      const tq = clampLen(sub(mul(e, I * wn * wn * b * ts2), mul([w.x, w.y, w.z], 2 * I * wn * b * ts2)), 900 * b);
      body.applyTorqueImpulse({ x: tq[0] * dt, y: tq[1] * dt, z: tq[2] * dt }, true);
    }
  }
  // impacts for sound and the fall score: impulse = m |dv - g dt| per part, as v1 measured it
  impacts(sim, dt, g) {
    const out = [];
    for (const n of this.order) {
      const b = this.body(sim, n), v = b.linvel(), lv = this.s.lastV[n];
      if (lv) { const dv = [v.x - lv[0], v.y - lv[1] - g * dt * b.gravityScale(), v.z - lv[2]], J = this.parts[n].m * len(dv); if (J > 18) out.push([n, J]); }
      this.s.lastV[n] = [v.x, v.y, v.z];
    }
    return out;
  }
  muzzle(sim) {
    const f = this.body(sim, 'rFore'), q = f.rotation(), t = f.translation(), dir = qrot(q, [0, -1, 0]);
    return { pos: add([t.x, t.y, t.z], mul(dir, this.parts.rFore.halfLen + 0.1)), dir, vel: f.linvel() };
  }
}
export { qmul, qconj, qrot, dot };
