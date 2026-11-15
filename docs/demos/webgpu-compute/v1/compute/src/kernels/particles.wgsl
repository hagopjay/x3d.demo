// particles.wgsl: X3D ParticleSystem step on the GPU. One thread = one particle.
// X3D mapping (ISO 19775-1 chapter 40 "Particle systems"), and what is NOT mapped: ConeEmitter -> respawn() (speed, angle, variation as +-fraction of speed; position; axis +Y only),
// ForcePhysicsModel force -> g used directly as an acceleration (emitter mass is IGNORED, i.e. mass = 1), WindPhysicsModel normalised direction * speed -> wind with a harness drag constant
// of 0.5 1/s that pulls the velocity toward it (surfaceArea, gustiness, turbulence IGNORED), BoundedPhysicsModel Box -> a bouncing floor at -size.y/2 with a harness restitution of 0.5
// (X3D has no restitution field), lifetimeVariation IGNORED (every particle lives exactly particleLifetime). The three.js bridge honours mass and lifetimeVariation; this kernel does not.
// State is 8 f32 per particle: pos.xyz, life (unused slot, kept for 32-byte stride), vel.xyz, age.
struct Params {
  n: u32, frame: u32, dt: f32, speed: f32,
  gx: f32, gy: f32, gz: f32, lifeMax: f32,
  wx: f32, wy: f32, wz: f32, drag: f32,
  ex: f32, ey: f32, ez: f32, floorY: f32,
  cosCone: f32, restitution: f32, variation: f32, seed: u32,   // cosCone = cos(angle), computed on the CPU in f64 so kernel and reference share one z base
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> S: array<f32>;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(i: u32, frame: u32, k: u32) -> f32 {
  return f32(pcg(i * 9781u + frame * 6271u + k * 26699u + P.seed) >> 8u) / 16777216.0;
}

fn respawn(i: u32, frame: u32) {
  let b = i * 8u;
  let z = mix(P.cosCone, 1.0, rnd(i, frame, 1u));
  let phi = 6.283185307179586 * rnd(i, frame, 2u);
  let s = sqrt(max(0.0, 1.0 - z * z));
  let sp = P.speed * (1.0 + P.variation * (2.0 * rnd(i, frame, 3u) - 1.0));
  S[b + 0u] = P.ex; S[b + 1u] = P.ey; S[b + 2u] = P.ez;
  S[b + 3u] = 0.0;
  S[b + 4u] = s * cos(phi) * sp; S[b + 5u] = z * sp; S[b + 6u] = s * sin(phi) * sp;  // cone axis = +Y
  S[b + 7u] = 0.0;
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = i * 8u;
  var pos = vec3<f32>(S[b], S[b + 1u], S[b + 2u]);
  var vel = vec3<f32>(S[b + 4u], S[b + 5u], S[b + 6u]);
  var age = S[b + 7u];
  let g = vec3<f32>(P.gx, P.gy, P.gz);
  let wind = vec3<f32>(P.wx, P.wy, P.wz);
  vel = vel + (g + (wind - vel) * P.drag) * P.dt;
  pos = pos + vel * P.dt;
  age = age + P.dt;
  if (pos.y < P.floorY) { pos.y = P.floorY + (P.floorY - pos.y); vel.y = -vel.y * P.restitution; }
  S[b] = pos.x; S[b + 1u] = pos.y; S[b + 2u] = pos.z;
  S[b + 4u] = vel.x; S[b + 5u] = vel.y; S[b + 6u] = vel.z; S[b + 7u] = age;
  if (age >= P.lifeMax) { respawn(i, P.frame); }
}

// init: stagger ages so the first frames are not a single wave
@compute @workgroup_size(64)
fn seed(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  respawn(i, 0xFFFFu);
  S[i * 8u + 7u] = rnd(i, 0xFFFFu, 4u) * P.lifeMax;
}
