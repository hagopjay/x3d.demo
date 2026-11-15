import * as G from '../src/gpu.js';
import * as PR from '../src/ref/particles.js';
import * as SK from '../src/ref/skinning.js';
import * as VO from '../src/ref/volume.js';
import * as NU from '../src/ref/nurbs.js';
import * as SP from '../src/ref/splats.js';

const HERE = import.meta.url, rel = (p) => new URL(p, HERE).href;   // paths resolve against this module, so the demo page can host a copy of the whole folder
const txt = async (u) => (await fetch(rel(u))).text();
const xml = async (u) => new DOMParser().parseFromString(await txt(u), 'application/xml');
const MUT = (() => { try { return JSON.parse(atob(new URLSearchParams(location.search).get('mut') || '') || '[]'); } catch { return []; } })();   // [[kernel, from, to]]: deliberate bugs, to prove the checks can fail
const K = {}; const kern = async (n) => { if (K[n]) return K[n]; let t = await txt(`../src/kernels/${n}.wgsl`); for (const [k, a, b] of MUT) if (k === n) { if (!t.includes(a)) throw new Error('mutation target not found: ' + a); t = t.replace(a, b); } return (K[n] = t); };
const wg = (n, s) => Math.ceil(n / s);
const f3 = (x) => +x.toPrecision(4);
const rate = (items, ms) => +(items / (ms / 1000)).toExponential(3);
const logs = []; const log = (...a) => { logs.push(a.join(' ')); console.log(...a); };

/* ---------------------------------------------------------------- particles */
async function particles(c, o) {
  const P = PR.fromX3D(await xml('../fixtures/particles-cone-wind.x3d')), code = await kern('particles');
  const [pStep, pSeed] = await Promise.all([G.pipeline(c, code, 'step'), G.pipeline(c, code, 'seed')]);
  const mk = (n) => { const Q = { ...P, n }; const S = G.empty(c, n * 32, GPUBufferUsage.STORAGE); return { Q, S }; };
  const ub = (Q) => G.buf(c, new Uint8Array(PR.pack(Q)), GPUBufferUsage.UNIFORM);
  /* correctness: GPU vs CPU over many steps. Case A is the fixture; case B sets EVERY uniform to a non-default value (and n not a multiple of 64), so a kernel that ignores or swaps a field cannot pass */
  const correct = async (Q, STEPS, label, fixture) => {
    const S = G.empty(c, Q.n * 32, GPUBufferUsage.STORAGE), enc = c.device.createCommandEncoder();
    { const u = ub(Q), p = enc.beginComputePass(); p.setPipeline(pSeed); p.setBindGroup(0, G.group(c, pSeed, [u, S])); p.dispatchWorkgroups(wg(Q.n, 64)); p.end(); }
    for (let f = 1; f <= STEPS; f++) { const u = ub({ ...Q, frame: f }); const p = enc.beginComputePass(); p.setPipeline(pStep); p.setBindGroup(0, G.group(c, pStep, [u, S])); p.dispatchWorkgroups(wg(Q.n, 64)); p.end(); }
    c.device.queue.submit([enc.finish()]);
    const gpu = await G.read(c, S, Q.n * 32), cpu = new Float32Array(Q.n * 8); PR.seed(Q, cpu); for (let f = 1; f <= STEPS; f++) PR.step({ ...Q, frame: f }, cpu);
    const live = new Float32Array(gpu.length), cpuL = new Float32Array(gpu.length); for (let i = 0; i < gpu.length; i++) { const dead = i % 8 === 3; live[i] = dead ? 0 : gpu[i]; cpuL[i] = dead ? 0 : cpu[i]; }
    const cmp = G.compare(live, cpuL, 1e-3);
    let badP = 0, respawned = 0; for (let i = 0; i < Q.n; i++) { let m = 0; for (let k = 0; k < 8; k++) m = Math.max(m, Math.abs(live[i * 8 + k] - cpuL[i * 8 + k])); if (m > 1e-2) badP++; if (cpu[i * 8 + 7] < (STEPS - 1) / 60) respawned++; }
    S.destroy();
    return { label, fixture, particles: Q.n, steps: STEPS, params: { speed: Q.speed, cos_cone: f3(Q.cosCone), variation: Q.variation, gravity: [Q.gx, Q.gy, Q.gz], wind: [Q.wx, Q.wy, Q.wz], drag: Q.drag, emitter: [Q.ex, Q.ey, Q.ez], floor_y: Q.floorY, restitution: Q.restitution, lifetime: Q.lifeMax, seed: Q.seed }, ...cmp, particles_off_by_more_than_1e_2: badP, particles_respawned_during_run: respawned,
      pass: cmp.outside_tol <= Math.ceil(0.002 * Q.n * 7) && badP <= Math.ceil(0.005 * Q.n) };
  };
  const caseA = await correct(P, 120, 'fixture', 'fixtures/particles-cone-wind.x3d');
  const caseB = await correct({ ...P, n: 4093, speed: 1.7, cosCone: Math.fround(Math.cos(0.4)), gx: 0.3, gy: -7, gz: -0.2, wx: 1.1, wy: 0.4, wz: -0.9, drag: 0.8, ex: 0.5, ey: 1, ez: -0.3, floorY: 0.2, restitution: 0.6, lifeMax: 1.3, variation: 0.4, seed: 99 }, 100, 'every uniform non-default', null);
  caseB.pass = caseB.pass && caseB.particles_respawned_during_run > 0;
  const correctness = { cases: [caseA, caseB], pass: caseA.pass && caseB.pass };
  /* bench */
  const rows = [];
  for (const n of o.noBench ? [] : o.quick ? [65536, 262144] : [65536, 262144, 1048576]) {
    const { Q: B, S: BS } = mk(n), u = ub(B), bg = G.group(c, pStep, [u, BS]), sg = G.group(c, pSeed, [u, BS]);
    { const e = c.device.createCommandEncoder(), p = e.beginComputePass(); p.setPipeline(pSeed); p.setBindGroup(0, sg); p.dispatchWorkgroups(wg(n, 64)); p.end(); c.device.queue.submit([e.finish()]); }
    const b = await G.bench(c, (e, ts) => { const p = e.beginComputePass({ timestampWrites: ts(0, 1) }); p.setPipeline(pStep); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(n, 64)); p.end(); }, { iters: 15 });
    const ms = b.gpu_ms?.median ?? b.wall_ms.median; rows.push({ particles: n, ...b, particles_per_s: rate(n, ms), bytes_per_particle: 64, flops_per_particle_est: 45, timing_source: b.gpu_ms ? 'timestamp-query' : 'wall' });
    BS.destroy(); u.destroy();
  }
  return { correctness, bench: rows };
}

/* ---------------------------------------------------------------- skinning */
async function skinning(c, o) {
  const code = await kern('skinning'), pipe = await G.pipeline(c, code, 'skin');
  const run = async (m, M, nv) => {
    const b = { rest: G.buf(c, m.rest), nrm: G.buf(c, m.nrm), idx: G.buf(c, m.idx), w: G.buf(c, m.w), M: G.buf(c, M), P: G.empty(c, nv * 16), N: G.empty(c, nv * 16) };
    const u = G.buf(c, new Uint32Array([nv, 0, 0, 0]), GPUBufferUsage.UNIFORM), bg = G.group(c, pipe, [u, b.rest, b.nrm, b.idx, b.w, b.M, b.P, b.N]);
    const enc = (e, ts) => { const p = e.beginComputePass({ timestampWrites: ts?.(0, 1) }); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(nv, 64)); p.end(); };
    return { b, enc, bg };
  };
  /* fixture */
  const doc = await xml('../fixtures/hanim-chain.x3d'), H = SK.fromX3D(doc), inf = SK.influences(H.joints, H.nv);
  const restN = new Float32Array(H.nv * 4); for (let v = 0; v < H.nv; v++) { const x = H.rest[v * 4], z = H.rest[v * 4 + 2], l = Math.hypot(x, z); restN.set([x / l, 0, z / l, 0], v * 4); }
  const pose = { 1: [0, 0, 1, 0.5], 2: [1, 0, 0, -0.8] }, M = SK.skinMatrices(H.joints, pose);
  const r = await run({ rest: H.rest, nrm: restN, idx: inf.idx, w: inf.w }, M, H.nv);
  { const e = c.device.createCommandEncoder(); r.enc(e); c.device.queue.submit([e.finish()]); }
  const gp = await G.read(c, r.b.P, H.nv * 16), gn = await G.read(c, r.b.N, H.nv * 16), ref = SK.skinCPU(H.rest, restN, inf.idx, inf.w, M, H.nv);
  const restPose = SK.skinCPU(H.rest, restN, inf.idx, inf.w, SK.skinMatrices(H.joints, {}), H.nv);
  let restErr = 0; for (let i = 0; i < H.rest.length; i++) restErr = Math.max(restErr, Math.abs(restPose.P[i] - H.rest[i]));
  const cp = G.compare(gp, ref.P, 1e-4), cn = G.compare(gn, ref.N, 1e-4);
  /* procedural 65k tube, 24 joints, posed */
  const T = SK.tube(65536, 24), TM = new Float32Array(25 * 16), pj = {}; for (let j = 1; j < 24; j++) pj[j] = [Math.sin(j), 0, Math.cos(j), 0.15 * Math.sin(j * 1.7)];
  TM.set(SK.skinMatrices(T.joints, pj)); const r2 = await run(T, TM, T.nv); { const e = c.device.createCommandEncoder(); r2.enc(e); c.device.queue.submit([e.finish()]); }
  const tp = await G.read(c, r2.b.P, T.nv * 16), tn = await G.read(c, r2.b.N, T.nv * 16), tref = SK.skinCPU(T.rest, T.nrm, T.idx, T.w, TM, T.nv);
  /* independent forward-kinematics check: expected positions were worked out by hand (SK.handChain), not computed by the reference; also covers 3 influences and an unweighted vertex */
  const HC = SK.handChain(), hinf = SK.influences(HC.joints, HC.nv), hM = SK.skinMatrices(HC.joints, HC.pose), hn = new Float32Array(HC.nv * 4); for (let v = 0; v < HC.nv; v++) hn.set([0, 1, 0, 0], v * 4);
  const hr = await run({ rest: HC.rest, nrm: hn, idx: hinf.idx, w: hinf.w }, hM, HC.nv); { const e = c.device.createCommandEncoder(); hr.enc(e); c.device.queue.submit([e.finish()]); }
  const hp = await G.read(c, hr.b.P, HC.nv * 16), hxyz = []; for (let v = 0; v < HC.nv; v++) hxyz.push(hp[v * 4], hp[v * 4 + 1], hp[v * 4 + 2]);
  const hand = { vertices: HC.nv, expected_by_hand: HC.expect, gpu: hxyz.map((x) => +x.toFixed(5)), max_abs_err: Math.max(...hxyz.map((x, i) => Math.abs(x - HC.expect[i]))), unweighted: hinf.unweighted, max_influences: 3 };
  hand.pass = hand.max_abs_err < 1e-5 && hinf.unweighted === 1;
  const correctness = { fixture: 'fixtures/hanim-chain.x3d', hand_checked_chain: hand, joints: H.joints.length, vertices: H.nv, vertices_dropped_over_4_influences: inf.dropped, vertices_unweighted: inf.unweighted, rest_pose_max_err: restErr, fixture_pos: G.compare(gp, ref.P, 1e-4), fixture_nrm: cn,
    tube_65536_24_joints: { pos: G.compare(tp, tref.P, 1e-4), nrm: G.compare(tn, tref.N, 1e-4) } };
  correctness.pass = hand.pass && cp.outside_tol === 0 && cn.outside_tol === 0 && restErr < 1e-6 && correctness.tube_65536_24_joints.pos.outside_tol === 0 && correctness.tube_65536_24_joints.nrm.outside_tol === 0;
  const rows = [];
  for (const n of o.noBench ? [] : o.quick ? [65536, 262144] : [65536, 262144, 1048576, 2097152]) {
    const m = SK.tube(n, 24), mm = new Float32Array(25 * 16); mm.set(SK.skinMatrices(m.joints, pj)); const x = await run(m, mm, m.nv);
    const b = await G.bench(c, x.enc, { iters: 15 }), ms = b.gpu_ms?.median ?? b.wall_ms.median;
    rows.push({ vertices: m.nv, joints: 24, ...b, vertices_per_s: rate(m.nv, ms), bytes_per_vertex: 16 + 16 + 16 + 16 + 16 + 16 + 16 * 4 /* cache-resident matrices counted once below */, flops_per_vertex_est: 4 * (2 * 16 + 2 * 9) + 20, timing_source: b.gpu_ms ? 'timestamp-query' : 'wall' });
    Object.values(x.b).forEach((q) => q.destroy());
  }
  return { correctness, bench: rows };
}

/* ---------------------------------------------------------------- volume */
async function volume(c, o) {
  const code = await kern('volume'), pipe = await G.pipeline(c, code, 'march');
  const mkTex = (d, vox) => { const t = c.device.createTexture({ size: [d, d, d], dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    c.device.queue.writeTexture({ texture: t }, vox, { bytesPerRow: d, rowsPerImage: d }, [d, d, d]); return t; };
  const mk = (d, vox, P) => { const t = mkTex(d, vox), u = G.buf(c, new Uint8Array(VO.pack(P)), GPUBufferUsage.UNIFORM), img = G.empty(c, P.w * P.h * 4), bg = G.group(c, pipe, [u, t, img]);
    return { t, u, img, enc: (e, ts) => { const p = e.beginComputePass({ timestampWrites: ts?.(0, 1) }); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(P.w, 8), wg(P.h, 8)); p.end(); } }; };
  const base = { yaw: 0.6, thr: 0.15, gain: 4, stepAlpha: 0.12 };
  const cmpImg = async (P, vox) => { const r = mk(P.dim, vox, P); { const e = c.device.createCommandEncoder(); r.enc(e); c.device.queue.submit([e.finish()]); }
    const g = new Uint8Array((await G.read(c, r.img, P.w * P.h * 4, Uint8Array)).buffer), cpu = VO.cast(P, vox); let sum = 0, mx = 0, big = 0, cov = 0, gcov = 0; for (let i = 0; i < g.length; i++) { const d = Math.abs(g[i] - cpu[i]); sum += d; if (d > mx) mx = d; if (d > 2) big++; if (i % 4 === 3) { if (cpu[i] > 0) cov++; if (g[i] > 0) gcov++; } }
    r.t.destroy(); r.u.destroy(); r.img.destroy(); return { w: P.w, h: P.h, dim: P.dim, steps: P.steps, yaw: f3(P.yaw), style: P.style ? 'MIP' : 'opacity', marched_pixels: VO.marched(P), mean_abs_diff_of_255: +(sum / g.length).toFixed(4), max_abs_diff: mx, bytes_off_by_more_than_2: big, covered_pixels: cov, gpu_covered_pixels: gcov }; };
  /* every case also reports how many pixels' rays enter the cube (marched) and how many came out non-black (covered); an image that is all black fails */
  const out = []; for (const f of ['volume-opacity', 'volume-mip']) { const v = VO.fromX3D(await xml(`../fixtures/${f}.x3d`)); out.push({ fixture: `fixtures/${f}.x3d`, ...(await cmpImg({ ...base, w: 64, h: 64, dim: v.dim, steps: 48, style: v.style }, v.vox)) }); }
  { const d = 64, vox = VO.makeVolume(d); for (const style of [0, 1]) out.push({ fixture: 'procedural 64^3', ...(await cmpImg({ ...base, w: 128, h: 128, dim: d, steps: 96, style }, vox)) }); }
  /* non-zero up to every face, four yaws (0 and pi/2 hit the axis-parallel branch of the slab test; 0.6 and 2.4 do not) */
  { const d = 32, vox = VO.rampVolume(d); for (const yaw of [0, Math.PI / 2, 0.6, 2.4]) for (const style of [0, 1]) out.push({ fixture: `ramp 32^3 yaw ${f3(yaw)}`, ...(await cmpImg({ ...base, thr: 0.05, yaw, w: 96, h: 96, dim: d, steps: 64, style }, vox)) }); }
  const correctness = { cases: out, pass: out.every((r) => r.mean_abs_diff_of_255 < 0.5 && r.bytes_off_by_more_than_2 <= r.w * r.h * 4 * 0.015 && r.marched_pixels > 0 && r.covered_pixels > 0 && Math.abs(r.gpu_covered_pixels - r.covered_pixels) <= 0.02 * r.covered_pixels + 2) };
  const rows = [];
  for (const [d, w, steps] of o.noBench ? [] : o.quick ? [[64, 256, 96]] : [[64, 256, 96], [128, 256, 192], [256, 512, 384]]) for (const style of [0, 1]) {
    const vox = VO.makeVolume(d), P = { ...base, w, h: w, dim: d, steps, style }, r = mk(d, vox, P), b = await G.bench(c, r.enc, { iters: 12 }), ms = b.gpu_ms?.median ?? b.wall_ms.median;
    rows.push({ volume: `${d}^3`, image: `${w}x${w}`, steps, style: style ? 'MIP' : 'opacity', ...b, rays_per_s: rate(w * w, ms), samples_per_s_upper: rate(w * w * steps, ms), timing_source: b.gpu_ms ? 'timestamp-query' : 'wall', note: 'samples_per_s_upper counts every step, early-out at alpha 0.99 skips some' });
    r.t.destroy(); r.u.destroy(); r.img.destroy();
  }
  return { correctness, bench: rows };
}

/* ---------------------------------------------------------------- nurbs */
async function nurbs(c, o) {
  const code = await kern('nurbs'), pipe = await G.pipeline(c, code, 'tess');
  const mk = (S) => { const pk = NU.pack(S), b = { u: G.buf(c, pk.uniform, GPUBufferUsage.UNIFORM), ctrl: G.buf(c, pk.ctrl), k: G.buf(c, pk.knots), P: G.empty(c, S.nu * S.nv * 16), N: G.empty(c, S.nu * S.nv * 16) }, bg = G.group(c, pipe, [b.u, b.ctrl, b.k, b.P, b.N]);
    return { b, enc: (e, ts) => { const p = e.beginComputePass({ timestampWrites: ts?.(0, 1) }); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(S.nu, 8), wg(S.nv, 8)); p.end(); } }; };
  const patches = NU.fromX3D(await xml('../fixtures/nurbs-patches.x3d')), cases = [];
  for (const S of patches) { const r = mk(S); { const e = c.device.createCommandEncoder(); r.enc(e); c.device.queue.submit([e.finish()]); }
    const gp = await G.read(c, r.b.P, S.nu * S.nv * 16), gn = await G.read(c, r.b.N, S.nu * S.nv * 16), ref = NU.tessellate(S); const cp = G.compare(gp, ref.P, 2e-5), cn = G.compare(gn, ref.N, 5e-4); const gw = new Float32Array(S.nu * S.nv), rw = new Float32Array(S.nu * S.nv); for (let i = 0; i < gw.length; i++) { gw[i] = gn[i * 4 + 3]; rw[i] = ref.N[i * 4 + 3]; } const cw = G.compareRel(gw, rw, 5e-3);
    cases.push({ def: S.def, control: `${S.du}x${S.dv}`, order: `${S.pu + 1}x${S.pv + 1}`, grid: `${S.nu}x${S.nv}`, rational: S.ctrl.some((p) => p[3] !== 1), pos_max_abs: cp.max_abs, pos_outside_tol: cp.outside_tol, nrm_max_abs: cn.max_abs, nrm_outside_tol: cn.outside_tol, area_w_outside_tol: cw.outside_tol, area_w_max_rel: cw.max_rel }); Object.values(r.b).forEach((q) => q.destroy()); }
  const correctness = { fixture: 'fixtures/nurbs-patches.x3d', reference: 'recursive Cox-de Boor in f64 (ref/nurbs.js)', cases, pass: cases.length >= 5 && cases.every((x) => x.pos_outside_tol === 0 && x.nrm_outside_tol === 0 && x.area_w_outside_tol === 0) };
  const rows = [];
  for (const g of o.noBench ? [] : o.quick ? [128, 512] : [128, 512, 1024, 2048]) { const S = NU.bench(8, g), r = mk(S), b = await G.bench(c, r.enc, { iters: 12 }), ms = b.gpu_ms?.median ?? b.wall_ms.median;
    rows.push({ grid: `${g}x${g}`, vertices: g * g, control: '8x8', order: '4x4', ...b, vertices_per_s: rate(g * g, ms), flops_per_vertex_est: 700, timing_source: b.gpu_ms ? 'timestamp-query' : 'wall' }); Object.values(r.b).forEach((q) => q.destroy()); }
  return { correctness, bench: rows };
}

/* ---------------------------------------------------------------- splats */
async function splats(c, o) {
  const code = await kern('splats');
  const [pPro, pNaive, pLS, pGl, pLM] = await Promise.all([G.pipeline(c, code, 'project'), G.pipeline(c, code, 'bitonic_naive'), G.pipeline(c, code, 'bitonic_local_sort'), G.pipeline(c, code, 'bitonic_global'), G.pipeline(c, code, 'bitonic_local_merge')]);
  const mk = async (cl, eye = [0, 3.2, 9]) => {
    const n = cl.n, np = SP.nextPow2(n), W = 1280, H = 720, fx = 900, view = SP.lookAt(eye);
    const C = { view, fx, fy: fx, w: W, h: H, n, znear: 0.2 };
    const b = { cam: G.buf(c, new Uint8Array(SP.packCam(C)), GPUBufferUsage.UNIFORM), pos: G.buf(c, cl.pos), scl: G.buf(c, cl.scl), q: G.buf(c, cl.quat), s2d: G.empty(c, n * 32), keys: G.empty(c, np * 4), vals: G.empty(c, np * 4) };
    const g0 = G.group(c, pPro, [b.cam, b.pos, b.scl, b.q, b.s2d, b.keys, b.vals]), ubs = [];
    const pg = (pipe, j, k) => { const u = G.buf(c, new Uint32Array([j, k, np, 0]), GPUBufferUsage.UNIFORM); ubs.push(u); return G.group(c, pipe, [u, b.keys, b.vals], 1); };
    const naive = SP.passes(np).map(([j, k]) => pg(pNaive, j, k));
    const tiled = SP.tiledPlan(np).map(([kind, a1, a2]) => kind === 'local_sort' ? { pipe: pLS, bg: pg(pLS, 0, 0), groups: np / 512 } : kind === 'global' ? { pipe: pGl, bg: pg(pGl, a1, a2), groups: np / 2 / 256 } : { pipe: pLM, bg: pg(pLM, 0, a1), groups: np / 512 });
    const pro = (e, ts, i = 0, nn = 1) => { const p = e.beginComputePass({ timestampWrites: ts?.(i, nn) }); p.setPipeline(pPro); p.setBindGroup(0, g0); p.dispatchWorkgroups(wg(np, 64)); p.end(); };
    const fullNaive = (e, ts) => { const nn = naive.length + 1; pro(e, ts, 0, nn); naive.forEach((g, i) => { const p = e.beginComputePass({ timestampWrites: ts?.(i + 1, nn) }); p.setPipeline(pNaive); p.setBindGroup(1, g); p.dispatchWorkgroups(wg(np, 256)); p.end(); }); };
    const fullTiled = (e, ts) => { const nn = tiled.length + 1; pro(e, ts, 0, nn); tiled.forEach((t, i) => { const p = e.beginComputePass({ timestampWrites: ts?.(i + 1, nn) }); p.setPipeline(t.pipe); p.setBindGroup(1, t.bg); p.dispatchWorkgroups(t.groups); p.end(); }); };
    return { b, ubs, C, np, n, passes: { naive: naive.length, tiled: tiled.length }, pro: (e, ts) => pro(e, ts), fullNaive, fullTiled };
  };
  const doc = await xml('../fixtures/splats-disc.x3d'), cl = SP.fromX3D(doc), r = await mk(cl);
  const run = (fn) => { const e = c.device.createCommandEncoder(); fn(e); c.device.queue.submit([e.finish()]); };
  run((e) => r.pro(e));
  const k0 = await G.read(c, r.b.keys, r.np * 4, Uint32Array), v0 = await G.read(c, r.b.vals, r.np * 4, Uint32Array), s2 = await G.read(c, r.b.s2d, r.n * 32), ref = SP.project(r.C, cl.pos, cl.scl, cl.quat, cl.n);
  let visGpu = 0, visRef = 0, mism = 0; const cmpv = [], cmpr = []; for (let i = 0; i < r.n; i++) { const vg = k0[i] !== 0xFFFFFFFF; visGpu += vg; visRef += ref.vis[i]; if (vg !== !!ref.vis[i]) mism++; else if (vg) for (let k = 0; k < 8; k++) { cmpv.push(s2[i * 8 + k]); cmpr.push(ref.out[i * 8 + k]); } }
  const proj = G.compareRel(Float32Array.from(cmpv), Float32Array.from(cmpr), 2e-3), want = SP.sortPairs(k0, v0);
  const checkSort = async (label, fn) => { run(fn); const k1 = await G.read(c, r.b.keys, r.np * 4, Uint32Array), v1 = await G.read(c, r.b.vals, r.np * 4, Uint32Array); let bad = 0, mono = true; for (let i = 0; i < r.np; i++) if (v1[i] !== want[i]) bad++; for (let i = 1; i < r.np; i++) if (k1[i - 1] > k1[i]) mono = false; return { variant: label, positions_wrong_vs_cpu_sort_of_gpu_keys: bad, keys_monotone: mono }; };
  const sortNaive = await checkSort('naive', (e) => r.fullNaive(e)), sortTiled = await checkSort('tiled', (e) => r.fullTiled(e));   // each re-projects first, so both start from the same unsorted keys
  const correctness = { fixture: 'fixtures/splats-disc.x3d', splats: r.n, padded: r.np, passes: r.passes, visible_gpu: visGpu, visible_cpu: visRef, visibility_mismatches: mism, projection: proj, sort: [sortNaive, sortTiled],
    pass: mism <= Math.ceil(0.002 * r.n) && proj.outside_tol <= Math.ceil(0.005 * cmpv.length) && [sortNaive, sortTiled].every((x) => x.positions_wrong_vs_cpu_sort_of_gpu_keys === 0 && x.keys_monotone) };
  Object.values(r.b).forEach((q) => q.destroy());
  /* projection edge cases: a wide cloud with random orientations and a camera inside it, so splats are behind the near plane, off screen, and anisotropic; checks keys (f32 bits of depth), padding keys and cull reasons, not only the visible count */
  { const wide = SP.cloud(3000, 11, 14, true), x = await mk(wide, [0, 1, 4]); run((e) => x.pro(e));
    const kk = await G.read(c, x.b.keys, x.np * 4, Uint32Array), ss = await G.read(c, x.b.s2d, x.n * 32), rf = SP.project(x.C, wide.pos, wide.scl, wide.quat, wide.n), f32b = new Uint32Array(1), f32v = new Float32Array(f32b.buffer);
    let pad = 0, keyBad = 0, mism = 0; const reasons = [0, 0, 0, 0], a = [], b2 = [];
    for (let i = x.n; i < x.np; i++) if (kk[i] === 0xFFFFFFFF) pad++;
    for (let i = 0; i < x.n; i++) { reasons[rf.why[i]]++; const vg = kk[i] !== 0xFFFFFFFF; if (vg !== !!rf.vis[i]) { mism++; continue; } if (vg) { f32b[0] = kk[i]; if (Math.abs(f32v[0] - rf.zs[i]) > 2e-5 * Math.max(1, Math.abs(rf.zs[i]))) keyBad++; /* key = f32 bits of view depth, compared as a float: cancellation in the f32 view transform moves small depths by a few ulp */ for (let q = 0; q < 8; q++) { a.push(ss[i * 8 + q]); b2.push(rf.out[i * 8 + q]); } } }
    const pr = G.compareRel(Float32Array.from(a), Float32Array.from(b2), 2e-3);
    correctness.projection_edge_cases = { splats: x.n, camera_eye: [0, 1, 4], culled_by_reason: { visible: reasons[0], behind_near_plane: reasons[1], degenerate_covariance: reasons[2], off_screen: reasons[3] }, padding_keys_all_max: pad === x.np - x.n, depth_key_wrong: keyBad, visibility_mismatches: mism, projection: pr };
    correctness.pass = correctness.pass && pad === x.np - x.n && keyBad === 0 && mism <= Math.ceil(0.002 * x.n) && pr.outside_tol <= Math.ceil(0.005 * a.length) && reasons[0] > 100 && reasons[1] > 100 && reasons[3] > 100;
    Object.values(x.b).forEach((q) => q.destroy()); }
  /* a second, larger exactness check on the tiled sort: 2^16 random-ish keys from the cloud generator, to exercise the cross-tile steps */
  { const x = await mk(SP.cloud(40000, 5)); run((e) => x.pro(e)); const kk = await G.read(c, x.b.keys, x.np * 4, Uint32Array), vv = await G.read(c, x.b.vals, x.np * 4, Uint32Array), w2 = SP.sortPairs(kk, vv); run((e) => x.fullTiled(e));
    const v2 = await G.read(c, x.b.vals, x.np * 4, Uint32Array); let bad = 0; for (let i = 0; i < x.np; i++) if (v2[i] !== w2[i]) bad++; correctness.tiled_sort_40000_splats_padded_65536 = { positions_wrong: bad, passes: x.passes.tiled }; correctness.pass = correctness.pass && bad === 0; Object.values(x.b).forEach((q) => q.destroy()); }
  const rows = [];
  for (const n of o.noBench ? [] : o.quick ? [65536, 262144] : [65536, 262144, 1048576]) {
    const x = await mk(SP.cloud(n, 3)), bp = await G.bench(c, x.pro, { iters: 12 }), bn = await G.bench(c, x.fullNaive, { iters: 6, budgetMs: 8000 }), bt = await G.bench(c, x.fullTiled, { iters: 10, budgetMs: 8000 });
    const m = (q) => q.gpu_ms?.median ?? q.wall_ms.median, mp = m(bp);
    rows.push({ splats: n, padded: x.np, passes: x.passes, project: bp, project_plus_naive_sort: bn, project_plus_tiled_sort: bt, project_splats_per_s: rate(n, mp), sort_ms_naive_derived: f3(Math.max(0, m(bn) - mp)), sort_ms_tiled_derived: f3(Math.max(0, m(bt) - mp)), speedup_tiled_over_naive_sort: f3((m(bn) - mp) / Math.max(1e-9, m(bt) - mp)), project_plus_tiled_splats_per_s: rate(n, m(bt)), timing_source: bt.gpu_ms ? 'timestamp-query' : 'wall' });
    Object.values(x.b).forEach((q) => q.destroy());
  }
  return { correctness, bench: rows };
}

export async function runAll(o = {}) {
  const t0 = performance.now(), c = await G.init(), res = { rig: { userAgent: navigator.userAgent, adapter: c.info, has_timestamp_query: c.hasTS, limits: c.limits, devicePixelRatio: devicePixelRatio, rAF_hz_hint: null, quick: !!o.quick }, suites: {} };
  const only = o.only || ['particles', 'skinning', 'volume', 'nurbs', 'splats'], S = { particles, skinning, volume, nurbs, splats };
  for (const k of only) { const t = performance.now(); try { res.suites[k] = await S[k](c, o); log(k, 'pass=' + res.suites[k].correctness.pass, Math.round(performance.now() - t) + 'ms'); } catch (e) { res.suites[k] = { error: String(e.stack || e) }; log(k, 'ERROR', e); } }
  res.gpu_errors = c.errors; res.total_s = +((performance.now() - t0) / 1000).toFixed(1); res.log = logs; return res;
}
window.X3DGPU = { runAll };
