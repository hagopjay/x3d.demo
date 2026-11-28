// HAUL simulation: one heavy 6x6 truck (and a trailer on its fifth wheel) climbing a level, at a fixed 240 Hz.
// Ammo (Bullet) moves the two rigid bodies, keeps the hitch and stops the chassis on the ground if it bottoms
// out or rolls. Everything that makes a truck climb or spin is ours, so it can be read and tinkered with:
//   - raycast suspension: each wheel is a circle swept down its strut onto the level's heightfield; a rock
//     ledge ahead of the hub touches first, so its force leans back against the truck, as a real step does
//   - tyres: combined slip with relaxation lengths (they build force like springs at a standstill, so the truck
//     can hold on a hill), a Pacejka-shaped curve per surface, mu from the surface, the rain, the puddle, the load
//     and the air pressure; Fx^2 + Fy^2 <= (mu Fz)^2 always
//   - diesel: torque curve, turbo spool (boost), torque converter (stall multiplication, lockup), automatic or
//     manual 6-speed, low range, exhaust brake, fuel map and smoke
//   - EV: two axle motors, constant torque then constant power, traction control, regenerative braking
//   - driveline: 6x4 or 6x6, open differentials (equal torque) or lockers (all driven wheels turn together)
import { G, SURFACES, TRUCK, DIESEL, EV, DRIVETRAIN, TYRE, TRAILER, surfaceMu, pressureEffect } from './spec.js';
import { sample, wetnessAt } from './level.js';
import { truckMass, trailerMass } from './feasible.js';

export const HZ = 240;
export const DT = 1 / HZ;
const RPM = 60 / (2 * Math.PI);

export const DEFAULT_SETUP = {
  power: 'diesel',          // 'diesel' | 'ev'
  drive: '6x4',             // '6x4' | '6x6'
  lockers: false,
  low: false,               // low range
  pressure: TYRE.pressure.nominal,
  ballast: 0,               // kg on the truck's deck
  fuelMap: 0,               // diesel: 0 stock .. 1 rolling coal
  auto: true,               // automatic gearbox
  traction: true,           // EV traction control
  exhaustBrake: false,
};

const v3 = () => ({ x: 0, y: 0, z: 0 });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b, o = v3()) => { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; o.x = x; o.y = y; o.z = z; return o; };
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; a.x /= l; a.y /= l; a.z /= l; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function curve(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + (ys[i] - ys[i - 1]) * f; }
  return ys[ys.length - 1];
}

/** Pacejka-shaped normalised force: 0 at s = 0, 1 at s = 1 (the peak), sin(C pi / 2) sliding. */
function shape(s, C) {
  const B = Math.tan(Math.PI / (2 * C));
  return Math.sin(C * Math.atan(B * s));
}

function quatRotate(q, v, o = v3()) {      // rotate v by unit quaternion q {x,y,z,w}
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  o.x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  o.y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  o.z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  return o;
}

function makeWheel(hub, radius, mass, inertia, opts) {
  return {
    hub, radius, mass, inertia, ...opts,
    omega: 0, angle: 0, steer: 0, length: TRUCK.suspension.rest, lengthRate: 0, kappa: 0, tana: 0,
    fz: 0, fx: 0, fy: 0, mu: 0, usage: 0, slip: 0, slipRatio: 0, surface: 0, puddle: 0, contact: false,
    world: v3(), point: v3(), normal: { x: 0, y: 1, z: 0 }, drive: 0, ledge: 0,
  };
}

/**
 * Create the simulation. Ammo: the loaded Ammo module. level: from level.fromX3D. setup: DEFAULT_SETUP overrides.
 * options.trailer: false to leave the trailer behind even on a level with a payload.
 */
export function createSim(Ammo, level, setup = {}, options = {}) {
  const S = { ...DEFAULT_SETUP, ...setup };
  const cfg = new Ammo.btDefaultCollisionConfiguration();
  const dispatcher = new Ammo.btCollisionDispatcher(cfg);
  const broadphase = new Ammo.btDbvtBroadphase();
  const solver = new Ammo.btSequentialImpulseConstraintSolver();
  const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, cfg);
  world.setGravity(new Ammo.btVector3(0, -G, 0));
  const tv = new Ammo.btVector3(0, 0, 0), tv2 = new Ammo.btVector3(0, 0, 0);
  const keep = [cfg, dispatcher, broadphase, solver, world, tv, tv2];

  // ground: the level's heightfield (the same grid the wheels sample)
  let hmin = Infinity, hmax = -Infinity;
  for (const h of level.heights) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
  const ptr = Ammo._malloc(4 * level.heights.length);
  Ammo.HEAPF32.set(level.heights, ptr >> 2);
  const ground = new Ammo.btHeightfieldTerrainShape(level.nx, level.nz, ptr, 1, hmin, hmax, 1, 'PHY_FLOAT', false);
  ground.setLocalScaling(new Ammo.btVector3(level.dx, 1, level.dz));
  const gt = new Ammo.btTransform(); gt.setIdentity();
  gt.setOrigin(new Ammo.btVector3(level.x0 + (level.nx - 1) * level.dx / 2, (hmin + hmax) / 2, level.z0 + (level.nz - 1) * level.dz / 2));
  const groundBody = new Ammo.btRigidBody(new Ammo.btRigidBodyConstructionInfo(0, new Ammo.btDefaultMotionState(gt), ground, new Ammo.btVector3(0, 0, 0)));
  groundBody.setFriction(0.7);
  world.addRigidBody(groundBody);

  const startX = level.start;
  const startZ = 0 + (level.meander ? level.meander[0] * Math.sin(startX / level.meander[1]) + level.meander[2] * Math.sin(startX / level.meander[3] + 1.3) : 0);
  const gy = sample(level, startX, startZ).y;

  // the ground's pitch along x where something is placed (so a spawn on a slope sits on it, not in it)
  const pitchAt = (x, z, span) => Math.atan2(sample(level, x + span, z).y - sample(level, x - span, z).y, 2 * span);
  function body(mass, half, offsetY, pos, inertiaScale = 1, pitch = 0) {
    const shape = new Ammo.btCompoundShape();
    const box = new Ammo.btBoxShape(new Ammo.btVector3(half[0], half[1], half[2]));
    const t = new Ammo.btTransform(); t.setIdentity(); t.setOrigin(new Ammo.btVector3(0, offsetY, 0));
    shape.addChildShape(t, box);
    const inertia = new Ammo.btVector3(0, 0, 0);
    shape.calculateLocalInertia(mass, inertia);
    inertia.setValue(inertia.x() * inertiaScale, inertia.y() * inertiaScale, inertia.z() * inertiaScale);
    const st = new Ammo.btTransform(); st.setIdentity(); st.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
    st.setRotation(new Ammo.btQuaternion(0, 0, Math.sin(pitch / 2), Math.cos(pitch / 2)));     // nose up by pitch
    const info = new Ammo.btRigidBodyConstructionInfo(mass, new Ammo.btDefaultMotionState(st), shape, inertia);
    const b = new Ammo.btRigidBody(info);
    b.setFriction(0.6); b.setRestitution(0.05); b.setDamping(0.0, 0.05);
    b.setActivationState(4);    // never sleep
    world.addRigidBody(b);
    keep.push(shape, box, t, inertia, st, info);
    return b;
  }

  // truck: wheels' mass is in the chassis; their spin inertia is in the wheel model
  const mTruck = truckMass(S.ballast) + (S.power === 'ev' ? EV.batteryMass : 0);
  const r = TRUCK.wheelRadius, susp = TRUCK.suspension;
  const sag = (mTruck * G / 6) / susp.stiffness;
  const mountY = -TRUCK.cgHeight + r + susp.rest - sag;
  const pitch = pitchAt(startX, startZ, 3.0);
  const truckPos = { x: startX, y: gy + TRUCK.cgHeight / Math.cos(pitch) + 0.05, z: startZ };
  const chassis = body(mTruck, TRUCK.size.map((v) => v / 2), TRUCK.boxY, truckPos, 1.15, pitch);
  const wheels = [];
  TRUCK.axles.forEach((a, k) => {
    for (const side of [1, -1]) {
      wheels.push(makeWheel({ x: a.x, y: mountY, z: side * TRUCK.track / 2 }, r, TRUCK.wheelMass, TRUCK.wheelInertia,
        { axle: k, side, steers: a.steer, driven6x4: a.drive6x4, onTrailer: false }));
    }
  });

  // trailer: a gooseneck lowboy; its centre of mass sits so the fifth wheel carries TRAILER.tongueShare at rest
  let trailer = null, hitch = null;
  const payload = options.trailer === false ? null : level.payload;
  if (payload != null) {
    const m = trailerMass(payload);
    const axleX = (TRAILER.axles[0] + TRAILER.axles[1]) / 2;
    const cgX = axleX + TRAILER.tongueShare * (TRAILER.kingpin[0] - axleX);    // on the deck, from its centre
    const tr = TRAILER.wheelRadius;
    const cgY = 1.2;                                                            // above the ground at rest
    // the kingpin goes on the fifth wheel (the truck's hitch, turned by the truck's pitch)
    const hx = truckPos.x + TRUCK.hitch[0] * Math.cos(pitch) - TRUCK.hitch[1] * Math.sin(pitch);
    const hy = truckPos.y + TRUCK.hitch[0] * Math.sin(pitch) + TRUCK.hitch[1] * Math.cos(pitch);
    const tx = hx - (TRAILER.kingpin[0] - cgX);
    const axleWorldX = tx + (axleX - cgX);
    const tPitch = Math.atan2(hy - TRUCK.hitch[1] - (sample(level, axleWorldX, startZ).y + cgY), hx - axleWorldX);
    const pos = { x: hx - (TRAILER.kingpin[0] - cgX) * Math.cos(tPitch), y: hy - TRUCK.hitch[1] - (TRAILER.kingpin[0] - cgX) * Math.sin(tPitch) + 0.05, z: startZ };
    const deck = [TRAILER.deck[0] / 2, TRAILER.deck[1] / 2, TRAILER.deck[2] / 2];
    const b = body(m, deck, 0.0, pos, 1.0, tPitch);
    const tSag = (m * (1 - TRAILER.tongueShare) * G / 4) / susp.stiffness;
    trailer = { body: b, mass: m, cgX, cgY, payload, wheels: [] };
    for (const ax of TRAILER.axles) {
      for (const side of [1, -1]) {
        trailer.wheels.push(makeWheel({ x: ax - cgX, y: -cgY + tr + susp.rest - tSag, z: side * TRAILER.track / 2 }, tr, TRAILER.wheelMass, TRAILER.wheelInertia,
          { axle: 3, side, steers: false, driven6x4: false, onTrailer: true }));
      }
    }
    const pivotA = new Ammo.btVector3(TRUCK.hitch[0], TRUCK.hitch[1], TRUCK.hitch[2]);
    // the kingpin in the trailer's frame: where the fifth wheel is now
    const dxw = hx - pos.x, dyw = hy - pos.y;
    const pivotB = new Ammo.btVector3(dxw * Math.cos(tPitch) + dyw * Math.sin(tPitch), -dxw * Math.sin(tPitch) + dyw * Math.cos(tPitch), 0);
    hitch = new Ammo.btPoint2PointConstraint(chassis, b, pivotA, pivotB);
    world.addConstraint(hitch, true);
    keep.push(pivotA, pivotB);
  }

  const sim = {
    level, setup: S, world, chassis, trailer, wheels, tick: 0, time: 0, keep,
    engine: { derate: 1, rpm: DIESEL.idle, omega: DIESEL.idle / RPM, boost: 0, torque: 0, power: 0, gear: 0, shifting: 0, locked: false, reverse: false, fuel: 0, smoke: 0, soot: 0, sr: 0, tr: 1, heat: 0 },
    battery: { kwh: EV.battery, kw: 0 },
    steer: 0, throttle: 0, brake: 0,
    status: 'driving', best: 0, distance: 0, events: [],
    out: { pos: v3(), quat: { x: 0, y: 0, z: 0, w: 1 }, vel: v3(), up: v3(), fwd: v3() },
    trailerOut: trailer ? { pos: v3(), quat: { x: 0, y: 0, z: 0, w: 1 } } : null,
  };
  readBody(Ammo, chassis, sim.out);
  if (trailer) readBody(Ammo, trailer.body, sim.trailerOut);
  sim.step = (input) => step(Ammo, sim, input);
  sim.destroy = () => {
    // Ammo's builds differ in what they export for freeing; release what this one has
    try { if (Ammo._free) Ammo._free(ptr); } catch (err) { /* leave it: the page reloads per level */ }
    try { Ammo.destroy(world); } catch (err) { /* idem */ }
  };
  return sim;
}

function readBody(Ammo, b, out) {
  const t = b.getWorldTransform();
  const o = t.getOrigin(), q = t.getRotation();
  out.pos.x = o.x(); out.pos.y = o.y(); out.pos.z = o.z();
  out.quat.x = q.x(); out.quat.y = q.y(); out.quat.z = q.z(); out.quat.w = q.w();
  if (out.vel) { const v = b.getLinearVelocity(); out.vel.x = v.x(); out.vel.y = v.y(); out.vel.z = v.z(); }
  if (out.up) { quatRotate(out.quat, { x: 0, y: 1, z: 0 }, out.up); quatRotate(out.quat, { x: 1, y: 0, z: 0 }, out.fwd); }
  return out;
}

const SAMPLES = [-0.8, -0.55, -0.3, 0, 0.3, 0.55, 0.8];    // offsets along the tyre's footprint, in radii
const tmp = { s: {}, a: v3(), b: v3(), c: v3(), d: v3(), e: v3(), f: v3(), g: v3() };

/**
 * Suspension and tyre for one wheel of a body. Returns nothing: applies the wheel's forces to the body and
 * leaves its state on the wheel. drive: torque at this wheel (N m); brake: torque capacity (N m).
 */
function wheelForces(Ammo, sim, b, pose, w, wetness, drive, brake, dt, tv, tv2) {
  const level = sim.level;
  const q = pose.quat, p = pose.pos;
  const up = quatRotate(q, { x: 0, y: 1, z: 0 }, tmp.a);
  const down = { x: -up.x, y: -up.y, z: -up.z };
  // the wheel's own axes: forward (chassis x turned by the steer angle about up), and its axle (left)
  const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
  const fwd0 = quatRotate(q, { x: cs, y: 0, z: sn }, tmp.b);        // steer > 0 turns left (+z)
  const mount = quatRotate(q, w.hub, tmp.c); mount.x += p.x; mount.y += p.y; mount.z += p.z;
  // sweep the circle down the strut onto the ground. Each footprint sample is a tangent plane (its point and the
  // terrain's normal there); the circle meets plane n.(X - g) = 0 when n.(mount + down L - g) = R, so
  // L = (R - n.(mount - g)) / (n.down). The plane met first (smallest L) is the contact: on a smooth slope every
  // sample gives the same plane; at a rock ledge the step's steep face is met first and leans back on the truck.
  const R = w.radius;
  let best = Infinity, bnx = 0, bny = 1, bnz = 0, gx = 0, gy = 0, gz = 0, bestS = 0, surfPick = 0, puddlePick = 0;
  const hubGuess = { x: mount.x + down.x * w.length, y: mount.y + down.y * w.length, z: mount.z + down.z * w.length };
  for (const s of SAMPLES) {
    const sx = hubGuess.x + fwd0.x * s * R, sz = hubGuess.z + fwd0.z * s * R;
    const g = sample(level, sx, sz, tmp.s);
    const nd = g.nx * down.x + g.ny * down.y + g.nz * down.z;
    if (nd > -0.2) continue;                                   // a face the strut cannot reach
    const L = (R - (g.nx * (mount.x - sx) + g.ny * (mount.y - g.y) + g.nz * (mount.z - sz))) / nd;
    if (L < best) { best = L; bnx = g.nx; bny = g.ny; bnz = g.nz; gx = sx; gy = g.y; gz = sz; bestS = s; surfPick = g.surface; puddlePick = g.puddle; }
  }
  const restMax = TRUCK.suspension.rest + 0.02;
  w.surface = surfPick; w.puddle = puddlePick * Math.min(1, wetness * 1.4);
  const prevLength = w.length;
  if (!(best < restMax)) {     // in the air
    w.contact = false; w.length = Math.min(restMax, prevLength + 0.5 * dt * 10); w.lengthRate = 0;
    w.fz = 0; w.fx = 0; w.fy = 0; w.usage = 0;
    w.kappa *= 0.9; w.tana *= 0.9;
    w.ground = 0; w.brake = brake;
    w.world.x = mount.x + down.x * w.length; w.world.y = mount.y + down.y * w.length; w.world.z = mount.z + down.z * w.length;
    return;
  }
  const L = Math.max(0, best);
  w.contact = true;
  w.length = L;
  w.lengthRate = (L - prevLength) / dt;
  const hub = { x: mount.x + down.x * L, y: mount.y + down.y * L, z: mount.z + down.z * L };
  w.world.x = hub.x; w.world.y = hub.y; w.world.z = hub.z;
  const n = { x: bnx, y: bny, z: bnz };
  w.ledge = n.y < 0.8 && Math.abs(bestS) > 0.25 ? bestS : 0;
  // the contact point: under the hub along the plane's normal
  gx = hub.x - n.x * R; gy = hub.y - n.y * R; gz = hub.z - n.z * R;
  w.normal.x = n.x; w.normal.y = n.y; w.normal.z = n.z;
  w.point.x = gx; w.point.y = gy; w.point.z = gz;
  // suspension force along the strut, and the normal load the tyre carries
  const susp = TRUCK.suspension;
  const comp = susp.rest - L;
  // digressive damping (truck dampers blow off at speed): linear to 0.3 m/s, a quarter as steep beyond, so a
  // rock ledge's sudden strut speed does not kick the wheel off the ground
  const vr = w.lengthRate, ar = Math.abs(vr);
  const damper = susp.damping * (ar < 0.3 ? ar : 0.3 + 0.25 * (ar - 0.3)) * Math.sign(vr);
  let spring = susp.stiffness * comp - damper;
  if (comp > susp.travel) spring += susp.stiffness * 12 * (comp - susp.travel);
  spring = clamp(spring, 0, 400000);        // a strut cannot push more than ~40 t: a bad contact cannot fire the truck
  const cosA = Math.max(0.3, -(down.x * n.x + down.y * n.y + down.z * n.z));
  const fz = spring / cosA;
  w.fz = fz;
  // the tyre's frame on the ground
  const left = quatRotate(q, { x: -sn, y: 0, z: cs }, tmp.d);
  const lat = norm({ x: left.x - dot(left, n) * n.x, y: left.y - dot(left, n) * n.y, z: left.z - dot(left, n) * n.z });
  const lon = cross(n, lat, tmp.e);
  // velocity of the contact point
  const lv = b.getLinearVelocity(), av = b.getAngularVelocity();
  const rx = gx - p.x, ry = gy - p.y, rz = gz - p.z;
  const vx = lv.x() + (av.y() * rz - av.z() * ry), vy = lv.y() + (av.z() * rx - av.x() * rz), vz = lv.z() + (av.x() * ry - av.y() * rx);
  const vLon = vx * lon.x + vy * lon.y + vz * lon.z, vLat = vx * lat.x + vy * lat.y + vz * lat.z;
  // grip
  const surf = SURFACES[w.surface];
  const sens = 1 - TYRE.loadSensitivity * (fz / TYRE.nominalLoad - 1);
  const pe = pressureEffect(sim.setup.pressure, w.surface);
  const mu = Math.max(0.05, surfaceMu(w.surface, wetness, w.puddle) * pe.grip * sens);
  w.mu = mu;
  // relaxation-length slip states (semi-implicit): a spring at a standstill, a slip ratio at speed
  const vs = w.omega * R - vLon;
  const ax = Math.abs(vLon);
  w.kappa = (w.kappa + dt * vs / TYRE.relaxX) / (1 + dt * ax / TYRE.relaxX);
  w.tana = (w.tana + dt * (-vLat) / TYRE.relaxY) / (1 + dt * ax / TYRE.relaxY);
  const sx = w.kappa / surf.kpk, sy = w.tana / TYRE.apk;
  const s = Math.hypot(sx, sy);
  let fxT = 0, fyT = 0;
  if (s > 1e-9) {
    const f = shape(s, surf.shape) * mu * fz;
    fxT = f * sx / s; fyT = f * sy / s;
  }
  // low-speed damping on the slip speed, kept inside the friction circle
  const lowDamp = TYRE.lowSpeedDamping * Math.max(0, 1 - ax / 2) * (fz / TYRE.nominalLoad);
  fxT += lowDamp * vs; fyT += lowDamp * (-vLat);
  const cap = mu * fz, mag = Math.hypot(fxT, fyT);
  if (mag > cap) { fxT *= cap / mag; fyT *= cap / mag; }
  w.fx = fxT; w.fy = fyT; w.usage = cap > 0 ? Math.hypot(fxT, fyT) / cap : 0;
  w.slip = vs; w.slipRatio = w.kappa;
  // rolling resistance is a moment on the wheel (the normal pressure sits ahead of the axle): it costs a driven
  // wheel torque, and makes an undriven one push back through its tyre. Mud bulldozing is a force on the body.
  const rr = surf.rr * pe.rr;
  w.ground = -fxT * R - rr * fz * R * Math.tanh(w.omega * R / 0.3);
  w.brake = brake;
  const sink = -surf.sink * fz * Math.tanh(vLon / 0.3);
  // the forces on the body, at the contact point
  const Fx = n.x * fz + lon.x * (fxT + sink) + lat.x * fyT;
  const Fy = n.y * fz + lon.y * (fxT + sink) + lat.y * fyT;
  const Fz = n.z * fz + lon.z * (fxT + sink) + lat.z * fyT;
  tv.setValue(Fx, Fy, Fz); tv2.setValue(rx, ry, rz);
  b.applyForce(tv, tv2);
}

function dieselTorque(e, throttle, setup) {
  const full = curve(DIESEL.rpm, DIESEL.torque, e.rpm) * (1 + 0.08 * setup.fuelMap);
  const avail = full * (DIESEL.naFraction + (1 - DIESEL.naFraction) * e.boost);
  return throttle * avail;
}

function step(Ammo, sim, input = {}) {
  const dt = DT, S = sim.setup, e = sim.engine;
  const [tv, tv2] = [sim.keep[5], sim.keep[6]];
  sim.events.length = 0;
  sim.time += dt; sim.tick++;
  const wetness = wetnessAt(sim.level, sim.time);
  sim.wetness = wetness;
  const throttle = clamp(input.throttle || 0, 0, 1), brakeIn = clamp(input.brake || 0, 0, 1);
  sim.throttle = throttle; sim.brake = brakeIn;
  const target = clamp(input.steer || 0, -1, 1) * TRUCK.steerMax;
  sim.steer += clamp(target - sim.steer, -TRUCK.steerRate * dt, TRUCK.steerRate * dt);

  readBody(Ammo, sim.chassis, sim.out);
  const speed = dot(sim.out.vel, sim.out.fwd);
  sim.speed = speed;
  const driven = sim.wheels.filter((w) => S.drive === '6x6' || w.driven6x4);
  const meanOmega = driven.reduce((a, w) => a + w.omega, 0) / driven.length;

  // ---- powertrain: the torque at each driven wheel ----
  let wheelTorque = 0;
  const range = S.low ? DRIVETRAIN.low : 1;
  if (S.power === 'diesel') {
    if (input.shiftUp && !S.auto && !e.reverse) e.gear = Math.min(DIESEL.gears.length - 1, e.gear + 1), e.shifting = DIESEL.shiftTime, sim.events.push('shift');
    if (input.shiftDown && !S.auto && !e.reverse) e.gear = Math.max(0, e.gear - 1), e.shifting = DIESEL.shiftTime, sim.events.push('shift');
    if (input.reverse !== undefined && input.reverse !== e.reverse && Math.abs(speed) < 1.5) { e.reverse = input.reverse; e.gear = 0; e.locked = false; }
    const ratio = (e.reverse ? DIESEL.reverse : DIESEL.gears[e.gear]) * DRIVETRAIN.final * range;
    const omegaT = meanOmega * ratio;                         // turbine
    // turbo: boost chases throttle, quicker with revs; the gap is unburnt fuel (smoke)
    const spool = DIESEL.spool * 1400 / Math.max(e.rpm, 650);
    const want = throttle * clamp((e.rpm - 650) / 650, 0, 1);
    e.boost += (want - e.boost) * dt * (want > e.boost ? 1 / spool : 3 / spool);
    e.boost = clamp(e.boost, 0, 1);
    // idle governor and limiter
    const governor = e.rpm < DIESEL.idle + 60 ? clamp((DIESEL.idle + 60 - e.rpm) / 90, 0, 1) : 0;
    let fuel = Math.max(throttle, governor);
    if (e.rpm > DIESEL.cut) fuel = 0;
    let te = dieselTorque(e, fuel, S);
    const friction = (DIESEL.friction[0] + DIESEL.friction[1] * e.rpm) * (1 - fuel);
    const retard = S.exhaustBrake && throttle < 0.02 ? DIESEL.exhaustBrake * clamp(e.rpm / 1800, 0, 1.2) : 0;
    te -= friction + retard;
    if (e.shifting > 0) { e.shifting -= dt; te *= 0.25; }
    const sr = e.omega > 1 ? omegaT / e.omega : 0;
    e.sr = sr;
    const C = DIESEL.converter;
    const lockable = !e.reverse && e.gear >= 1 && e.shifting <= 0 && sr > C.lockSR && sr < 1.08;
    if (lockable && !e.locked) e.locked = true;
    if (e.locked && (sr < 0.85 || e.gear < 1 || e.reverse)) e.locked = false;
    let shaft;
    if (e.locked) {
      e.omega = Math.max(DIESEL.idle * 0.7 / RPM, Math.abs(omegaT));
      shaft = te; e.tr = 1;
    } else {
      const rpmE = e.omega * RPM;
      const capacity = sr <= 1 ? 1 - Math.pow(clamp(sr, 0, 1), 3) : -(sr - 1) * 3;
      const pump = Math.sign(capacity) * Math.min(Math.abs(capacity), 2) * (rpmE / C.kStall) ** 2;
      const tr = sr < C.couplingSR ? C.stallTR - (C.stallTR - 1) * Math.max(0, sr) / C.couplingSR : 1;   // stall TR at most
      e.tr = tr;
      shaft = tr * pump;
      e.omega += dt * (te - pump) / DIESEL.inertia;
      e.omega = clamp(e.omega, 300 / RPM, DIESEL.cut * 1.05 / RPM);
    }
    e.rpm = e.omega * RPM;
    e.torque = te; e.power = te * e.omega;
    wheelTorque = input.neutral ? 0 : shaft * ratio * DRIVETRAIN.efficiency;
    if (input.neutral) { e.locked = false; }
    // automatic: up above the shift speed (lower at part throttle), down when the revs sag
    if (S.auto && !e.reverse && e.shifting <= 0) {
      const turbineRpm = Math.abs(omegaT) * RPM;
      const up = DIESEL.shiftUp * (0.72 + 0.28 * throttle);
      if (e.gear < DIESEL.gears.length - 1 && turbineRpm > up && (e.locked || sr > 0.8)) { e.gear++; e.shifting = DIESEL.shiftTime; e.locked = false; sim.events.push('shift'); }
      else if (e.gear > 0 && turbineRpm < DIESEL.shiftDown * (e.gear > 2 ? 1 : 0.8) && throttle > 0.3) { e.gear--; e.shifting = DIESEL.shiftTime; e.locked = false; sim.events.push('shift'); }
    }
    // fuel and smoke: g/s from power, and soot from fuel the turbo cannot yet burn (and the fuel map)
    const kW = Math.max(0, e.power) / 1000;
    e.fuel = DIESEL.bsfc * kW / 3600 + 0.4 * fuel;
    e.soot = clamp(fuel * (1 - e.boost) * 1.4 + S.fuelMap * fuel * 1.6 + (e.shifting > 0 ? 0.6 * throttle : 0), 0, 3);
    e.smoke = e.fuel * (0.15 + e.soot);
    e.heat = Math.min(1, e.heat + dt * (kW / 450 - e.heat) * 0.05);
  } else {
    // EV: torque to the base speed, then power; regenerative braking when coasting
    if (input.reverse !== undefined && input.reverse !== e.reverse && Math.abs(speed) < 1.5) e.reverse = input.reverse;
    const dir = e.reverse ? -1 : 1;
    const om = Math.max(Math.abs(meanOmega), 0.5);
    // thermal derating: copper losses (torque squared) heat the motors; rain on the casings cools them a little
    const derate = 1 - (1 - EV.derateTo) * clamp((e.heat - EV.derateFrom) / (1 - EV.derateFrom), 0, 1);
    e.derate = derate;
    const limit = Math.min(EV.wheelTorque * (S.drive === '6x6' ? 1 : 0.62), EV.power / om) * derate;
    let t = dir * throttle * limit;
    if (Math.abs(meanOmega) * RPM > EV.maxWheelRpm) t = 0;
    if (throttle < 0.02 && Math.abs(meanOmega) > 0.5) t = -Math.sign(meanOmega) * EV.regen * EV.wheelTorque * Math.min(1, Math.abs(meanOmega) / 3);
    if (input.neutral) t = 0;
    wheelTorque = t;
    const p = t * meanOmega;
    sim.battery.kw = p / 1000;
    sim.battery.kwh -= (p > 0 ? p / EV.efficiency : p * EV.efficiency) * dt / 3.6e6;
    e.rpm = Math.abs(meanOmega) * RPM * 9; e.torque = t; e.power = p; e.smoke = 0; e.soot = 0; e.boost = 0;
    const load = Math.abs(t) / (EV.wheelTorque * (S.drive === '6x6' ? 1 : 0.62));
    const heatTarget = 1.25 * load * load - 0.15 * wetness;
    e.heat = clamp(e.heat + dt * (heatTarget - e.heat) / EV.heatTime, 0, 1);
  }

  // ---- wheels: tyre forces first, then the driveline turns the wheels ----
  for (const w of sim.wheels) w.steer = w.steers ? sim.steer : 0;
  const brakeTorque = brakeIn * TRUCK.brakeTorque;
  for (const w of sim.wheels) {
    let d = (S.drive === '6x6' || w.driven6x4) ? 1 : 0;
    // EV traction control: per-wheel torque trim on slip (the motors react in milliseconds)
    if (S.power === 'ev' && S.traction && d !== 0 && w.contact && wheelTorque > 0) {
      const vg = Math.abs(w.omega * w.radius) - Math.abs(sim.speed);
      const ratio = vg / Math.max(1.5, Math.abs(sim.speed));
      if (ratio > EV.tcSlip) d *= clamp(1 - (ratio - EV.tcSlip) * 4, 0.15, 1);
    }
    w.share = d;
    wheelForces(Ammo, sim, sim.chassis, sim.out, w, wetness, 0, brakeTorque, dt, tv, tv2);
  }
  // the driveline. Source torque T at the carrier (all driven wheels), and the engine's inertia reflected onto it
  // when the converter is locked (I_r = I_e G^2). Open differentials: equal torque, so with the carrier turning at
  // the driven wheels' mean speed, w_c' (I_w + I_r / N) = T / N + mean(ground), T_c = T - I_r w_c'.
  // Lockers: every driven wheel turns at one speed, w' = (T + sum ground) / (sum I_w + I_r).
  const N = driven.length;
  const Ir = S.power === 'diesel' && e.locked ? DIESEL.inertia * ((DIESEL.gears[e.gear] * DRIVETRAIN.final * range) ** 2) : 0;
  const shares = driven.reduce((a, w) => a + w.share, 0) || 1;
  if (S.lockers) {
    let I = Ir, T = wheelTorque, L = 0;
    for (const w of driven) { I += w.inertia; T += w.ground; L += w.inertia * w.omega; }
    let omega = (L + Ir * meanOmega) / (I) + dt * T / I;
    const hold = driven.reduce((a, w) => a + w.brake, 0);
    if (Math.abs(omega) * I / dt <= hold) omega = 0; else omega -= Math.sign(omega) * hold * dt / I;
    for (const w of driven) { w.omega = omega; w.drive = wheelTorque / N; }
  } else {
    const Iw = driven.reduce((a, w) => a + w.inertia, 0) / N;
    const meanGround = driven.reduce((a, w) => a + w.ground, 0) / N;
    const carrierAcc = (wheelTorque / N + meanGround) / (Iw + Ir / N);
    const Tc = wheelTorque - Ir * carrierAcc;
    for (const w of driven) {
      w.drive = Tc * w.share / shares;
      const free = w.omega + dt * (w.drive + w.ground) / w.inertia;
      w.omega = w.brake * dt / w.inertia >= Math.abs(free) ? 0 : free - Math.sign(free) * w.brake * dt / w.inertia;
    }
  }
  for (const w of sim.wheels) {
    if (!(S.drive === '6x6' || w.driven6x4)) {
      w.drive = 0;
      const free = w.omega + dt * w.ground / w.inertia;
      w.omega = w.brake * dt / w.inertia >= Math.abs(free) ? 0 : free - Math.sign(free) * w.brake * dt / w.inertia;
    }
    w.angle += w.omega * dt;
  }
  if (sim.trailer) {
    const tp = readBody(Ammo, sim.trailer.body, sim.trailerOut);
    for (const w of sim.trailer.wheels) {
      wheelForces(Ammo, sim, sim.trailer.body, tp, w, wetness, 0, brakeTorque * 0.6, dt, tv, tv2);
      const free = w.omega + dt * w.ground / w.inertia;
      w.omega = w.brake * dt / w.inertia >= Math.abs(free) ? 0 : free - Math.sign(free) * w.brake * dt / w.inertia;
      w.angle += w.omega * dt;
    }
  }
  // aerodynamic drag
  const v = sim.out.vel, vv = Math.hypot(v.x, v.y, v.z);
  if (vv > 0.1) {
    const k = 0.5 * 1.2 * TRUCK.dragArea * vv;
    tv.setValue(-k * v.x, -k * v.y, -k * v.z);
    sim.chassis.applyCentralForce(tv);
  }
  sim.world.stepSimulation(dt, 0, dt);
  readBody(Ammo, sim.chassis, sim.out);
  if (sim.trailer) readBody(Ammo, sim.trailer.body, sim.trailerOut);

  // ---- progress and outcome ----
  const x = sim.out.pos.x;
  sim.distance = x - sim.level.start;
  sim.best = Math.max(sim.best, sim.distance);
  if (sim.status === 'driving') {
    const g = sample(sim.level, x, sim.out.pos.z);
    if (sim.out.up.y < 0.35) sim.status = 'rolled';
    else if (sim.out.pos.y < g.y - 4) sim.status = 'fell';
    else if (x >= sim.level.summit) sim.status = 'summit';
  }
  for (const w of sim.wheels) {
    if (w.contact && w.puddle > 0.01 && Math.abs(sim.speed) > 1.2) sim.events.push('splash');
    if (w.contact && Math.abs(w.slip) > 2.5) sim.events.push(w.surface === 3 ? 'mud' : 'spin');
  }
  return sim;
}

/** A compact digest of the state, for determinism tests and tapes. */
export function digest(sim) {
  const p = sim.out.pos, q = sim.out.quat;
  const parts = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, sim.engine.rpm, ...sim.wheels.map((w) => w.omega)];
  if (sim.trailerOut) parts.push(sim.trailerOut.pos.x, sim.trailerOut.pos.y);
  return parts.map((v) => v.toFixed(6)).join(',');
}
