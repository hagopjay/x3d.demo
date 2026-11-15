/* CPU reference for particles.wgsl: the same integer hash and the same f32 arithmetic (Math.fround after every operation that the shader does in f32). */
const f = Math.fround;
export const pcg = (v) => { v = v >>> 0; const s = (Math.imul(v, 747796405) + 2891336453) >>> 0; const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0; return ((w >>> 22) ^ w) >>> 0; };
export const rnd = (P, i, frame, k) => (pcg((Math.imul(i, 9781) + Math.imul(frame, 6271) + Math.imul(k, 26699) + P.seed) >>> 0) >>> 8) / 16777216;

export function respawn(P, S, i, frame) {
  const b = i * 8, z = f(P.cosCone + f(f(1 - P.cosCone) * f(rnd(P, i, frame, 1)))), phi = f(6.283185307179586 * rnd(P, i, frame, 2));
  const s = f(Math.sqrt(Math.max(0, f(1 - f(z * z))))), sp = f(P.speed * f(1 + f(P.variation * f(f(2 * rnd(P, i, frame, 3)) - 1))));
  S[b] = P.ex; S[b + 1] = P.ey; S[b + 2] = P.ez; S[b + 3] = 0;
  S[b + 4] = f(f(s * f(Math.cos(phi))) * sp); S[b + 5] = f(z * sp); S[b + 6] = f(f(s * f(Math.sin(phi))) * sp); S[b + 7] = 0;
}
export function seed(P, S) { for (let i = 0; i < P.n; i++) { respawn(P, S, i, 0xFFFF); S[i * 8 + 7] = f(rnd(P, i, 0xFFFF, 4) * P.lifeMax); } }
export function step(P, S) {
  for (let i = 0; i < P.n; i++) {
    const b = i * 8; let px = S[b], py = S[b + 1], pz = S[b + 2], vx = S[b + 4], vy = S[b + 5], vz = S[b + 6], age = S[b + 7];
    vx = f(vx + f(f(P.gx + f(f(P.wx - vx) * P.drag)) * P.dt)); vy = f(vy + f(f(P.gy + f(f(P.wy - vy) * P.drag)) * P.dt)); vz = f(vz + f(f(P.gz + f(f(P.wz - vz) * P.drag)) * P.dt));
    px = f(px + f(vx * P.dt)); py = f(py + f(vy * P.dt)); pz = f(pz + f(vz * P.dt)); age = f(age + P.dt);
    if (py < P.floorY) { py = f(P.floorY + f(P.floorY - py)); vy = f(-vy * P.restitution); }
    S[b] = px; S[b + 1] = py; S[b + 2] = pz; S[b + 4] = vx; S[b + 5] = vy; S[b + 6] = vz; S[b + 7] = age;
    if (age >= P.lifeMax) respawn(P, S, i, P.frame);
  }
}
/* uniform block in the order of struct Params */
export function pack(P) {
  const a = new ArrayBuffer(80), u = new Uint32Array(a), fl = new Float32Array(a);
  u[0] = P.n; u[1] = P.frame; fl[2] = P.dt; fl[3] = P.speed; fl[4] = P.gx; fl[5] = P.gy; fl[6] = P.gz; fl[7] = P.lifeMax; fl[8] = P.wx; fl[9] = P.wy; fl[10] = P.wz; fl[11] = P.drag;
  fl[12] = P.ex; fl[13] = P.ey; fl[14] = P.ez; fl[15] = P.floorY; fl[16] = P.cosCone; fl[17] = P.restitution; fl[18] = P.variation; u[19] = P.seed >>> 0; return a;
}
/* X3D fixture -> Params. Ignores (deliberately, see particles.wgsl): emitter mass, surfaceArea, lifetimeVariation, gustiness, turbulence; drag 0.5 and restitution 0.5 are harness constants. Reads ConeEmitter, ForcePhysicsModel, WindPhysicsModel, BoundedPhysicsModel(Box) and the system's lifetime. */
export function fromX3D(doc) {
  const $ = (t) => doc.getElementsByTagName(t)[0], num = (e, a, d) => (e && e.hasAttribute(a) ? e.getAttribute(a).trim().split(/\s+/).map(Number) : d);
  const ps = $('ParticleSystem'), em = $('ConeEmitter'), fo = $('ForcePhysicsModel'), wi = $('WindPhysicsModel'), bo = $('BoundedPhysicsModel');
  if (!ps || !em) throw new Error('fixture needs ParticleSystem + ConeEmitter');
  const dir = num(em, 'direction', [0, 1, 0]); if (Math.abs(dir[0]) + Math.abs(dir[2]) > 1e-6 || dir[1] <= 0) throw new Error('kernel supports a +Y cone axis only (gap)');
  const pos = num(em, 'position', [0, 0, 0]), force = num(fo, 'force', [0, 0, 0]), wd = num(wi, 'direction', [0, 0, 0]), ws = num(wi, 'speed', [0])[0];
  const wl = Math.hypot(...wd) || 1;   // ISO: the wind direction is a unit vector, so normalise what the file says
  let floorY = -1e30; const box = bo && bo.getElementsByTagName('Box')[0]; if (box) { const sz = num(box, 'size', [2, 2, 2]); floorY = -sz[1] / 2; }
  return {
    n: num(ps, 'maxParticles', [200])[0], frame: 0, dt: 1 / 60, speed: num(em, 'speed', [0.5])[0], gx: force[0], gy: force[1], gz: force[2], lifeMax: num(ps, 'particleLifetime', [5])[0],
    wx: wd[0] / wl * ws, wy: wd[1] / wl * ws, wz: wd[2] / wl * ws, drag: wi ? 0.5 : 0, ex: pos[0], ey: pos[1], ez: pos[2], floorY, cosCone: Math.fround(Math.cos(num(em, 'angle', [0.7854])[0])), restitution: 0.5, variation: num(em, 'variation', [0.25])[0], seed: 1234567,
  };
}
