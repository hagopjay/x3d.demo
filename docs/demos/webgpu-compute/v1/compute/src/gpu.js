/* gpu.js: the smallest WebGPU helper the X3D compute kernels need. ES module, no dependencies.
   One Ctx = one adapter + device. `bench()` measures a workload three ways: GPU timestamps (when the adapter exposes timestamp-query),
   wall clock around submit + onSubmittedWorkDone, and a real requestAnimationFrame loop (the bridge test harness stubs frames at 300 ms,
   so frame numbers taken there are not frame numbers). */
export async function init() {
  if (!navigator.gpu) throw new Error('navigator.gpu missing (needs a secure context: http://localhost or https)');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('requestAdapter() returned null');
  const hasTS = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: hasTS ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 1 << 30), maxBufferSize: Math.min(adapter.limits.maxBufferSize, 1 << 30) },
  });
  device.addEventListener?.('uncapturederror', (e) => { console.error('WEBGPU ERROR', e.error.message); ctxErrors.push(e.error.message); });
  const info = adapter.info || {};
  return { device, hasTS, errors: ctxErrors, info: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }, limits: { maxWG: adapter.limits.maxComputeInvocationsPerWorkgroup, maxStorage: adapter.limits.maxStorageBufferBindingSize, maxBuf: adapter.limits.maxBufferSize } };
}
const ctxErrors = [];

export const U = GPUBufferUsage;
export function buf(c, data, usage = U.STORAGE) {
  const b = c.device.createBuffer({ size: Math.max(16, (data.byteLength + 3) & ~3), usage: usage | U.COPY_DST | U.COPY_SRC, mappedAtCreation: false });
  c.device.queue.writeBuffer(b, 0, data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
  return b;
}
export function empty(c, bytes, usage = U.STORAGE) { return c.device.createBuffer({ size: Math.max(16, (bytes + 3) & ~3), usage: usage | U.COPY_SRC | U.COPY_DST }); }
export async function read(c, b, bytes, T = Float32Array) {
  const st = c.device.createBuffer({ size: (bytes + 3) & ~3, usage: U.MAP_READ | U.COPY_DST });
  const e = c.device.createCommandEncoder(); e.copyBufferToBuffer(b, 0, st, 0, (bytes + 3) & ~3); c.device.queue.submit([e.finish()]);
  await st.mapAsync(GPUMapMode.READ); const out = new T(st.getMappedRange().slice(0, bytes)); st.unmap(); st.destroy(); return out;
}
export async function pipeline(c, code, entry, layout = 'auto', constants) {
  const module = c.device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const bad = info.messages.filter((m) => m.type === 'error');
  if (bad.length) throw new Error('WGSL ' + entry + ': ' + bad.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
  return c.device.createComputePipelineAsync({ layout, compute: { module, entryPoint: entry, constants } });
}
export function group(c, pipe, entries, idx = 0) {
  const res = (r) => (r instanceof GPUBuffer ? { buffer: r } : r instanceof GPUTexture ? r.createView() : r);
  return c.device.createBindGroup({ layout: pipe.getBindGroupLayout(idx), entries: entries.map((r, binding) => ({ binding, resource: res(r) })) });
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* bench(c, encode, {iters, warm, passes, frames}):
     encode(enc, ts) records one workload; `ts(i, n)` returns the timestampWrites descriptor for compute pass i of n (or undefined) so the
     first pass writes the begin stamp and the last pass the end stamp.
   returns {gpu_ms: {median,p95}|null, wall_ms: {median,p95}, raf: {fps, frame_ms_median, frame_ms_p95, frames, workload_ms_in_frame}} */
export async function bench(c, encode, { iters = 15, warm = 3, frames = 90, budgetMs = 3000 } = {}) {
  const d = c.device; let qs = null, resolve = null, rb = null;
  if (c.hasTS) {
    qs = d.createQuerySet({ type: 'timestamp', count: 2 });
    resolve = d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    rb = d.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }
  const tsFor = (i, n) => (qs ? { querySet: qs, ...(i === 0 ? { beginningOfPassWriteIndex: 0 } : {}), ...(i === n - 1 ? { endOfPassWriteIndex: 1 } : {}) } : undefined);
  const gpu = [], wall = [];
  { const e = d.createCommandEncoder(); encode(e, () => undefined); const t = performance.now(); d.queue.submit([e.finish()]); await d.queue.onSubmittedWorkDone(); const first = performance.now() - t;   // cold probe, also sizes the run
    iters = Math.max(3, Math.min(iters, Math.floor(budgetMs / Math.max(first, 0.01)))); frames = Math.max(12, Math.min(frames, Math.floor(budgetMs / Math.max(first, 16.7)))); warm = first > 200 ? 1 : warm; }
  for (let k = 0; k < warm + iters; k++) {
    const e = d.createCommandEncoder(); encode(e, (i, n) => (i === 0 || i === n - 1 ? tsFor(i, n) : undefined));
    if (qs) { e.resolveQuerySet(qs, 0, 2, resolve, 0); e.copyBufferToBuffer(resolve, 0, rb, 0, 16); }
    const t0 = performance.now(); d.queue.submit([e.finish()]); await d.queue.onSubmittedWorkDone(); const t1 = performance.now();
    if (k >= warm) {
      wall.push(t1 - t0);
      if (qs) { await rb.mapAsync(GPUMapMode.READ); const t = new BigUint64Array(rb.getMappedRange().slice(0)); rb.unmap(); gpu.push(Number(t[1] - t[0]) / 1e6); }
    }
  }
  /* real rAF: one workload per frame, frame-to-frame time from the rAF timestamps */
  const dts = []; let last = 0, left = frames, inFrame = [], tStart = 0, tEnd = 0;
  await new Promise((res) => {
    const tick = (ts) => {
      if (last) dts.push(ts - last); else tStart = performance.now(); last = ts;
      const e = d.createCommandEncoder(); encode(e, () => undefined); const t0 = performance.now(); d.queue.submit([e.finish()]);
      d.queue.onSubmittedWorkDone().then(() => inFrame.push(performance.now() - t0));
      if (--left > 0) requestAnimationFrame(tick); else d.queue.onSubmittedWorkDone().then(() => { tEnd = performance.now(); res(); });
    };
    requestAnimationFrame(tick);
  });
  const body = dts.slice(2); const fm = median(body);
  qs?.destroy(); resolve?.destroy(); rb?.destroy();
  const r = (x) => +x.toFixed(4);
  return {
    gpu_ms: gpu.length ? { median: r(median(gpu)), p95: r(pct(gpu, 0.95)) } : null,
    wall_ms: { median: r(median(wall)), p95: r(pct(wall, 0.95)) },
    raf: { frames, rAF_dt_ms_median: r(fm), rAF_dt_ms_p95: r(pct(body, 0.95)), fps_raf: +(1000 / fm).toFixed(1), sustained_ms_per_frame: r((tEnd - tStart) / frames), fps_sustained: +(frames / ((tEnd - tStart) / 1000)).toFixed(1), submit_to_done_ms_median: r(median(inFrame)) },
  };
}

/* numeric comparison helper for the receipts */
export function compare(a, b, tol) {
  let max = 0, sum = 0, bad = 0, n = a.length;
  for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; if (!(d <= tol * (1 + Math.abs(b[i])))) bad++; }
  return { n, max_abs: +max.toPrecision(4), mean_abs: +(sum / n).toPrecision(4), outside_tol: bad, tol };
}

/* relative comparison with a magnitude floor, for quantities that are small by nature (a conic is ~1/sigma^2) */
export function compareRel(a, b, rel, floor = 1e-3) {
  let max = 0, bad = 0; const n = a.length;
  for (let i = 0; i < n; i++) { const e = Math.abs(a[i] - b[i]) / Math.max(Math.abs(b[i]), floor); if (e > max) max = e; if (!(e <= rel)) bad++; }
  return { n, max_rel: +max.toPrecision(4), outside_tol: bad, rel_tol: rel, floor };
}
