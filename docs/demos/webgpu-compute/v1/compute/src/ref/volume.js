/* CPU reference for volume.wgsl (same nearest-voxel sampling, same step positions, same f32 inputs). Returns Uint8 RGBA like the shader's packed u32. */
export function pack(P) {
  const a = new ArrayBuffer(64), u = new Uint32Array(a), fl = new Float32Array(a);
  u.set([P.w, P.h, P.dim, P.steps, P.style, 0, 0, 0]); fl.set([Math.cos(P.yaw), Math.sin(P.yaw), P.thr, P.gain, P.stepAlpha, 0, 0, 0], 8); return a;
}
export function cast(P, vox) {
  const out = new Uint8Array(P.w * P.h * 4), c = Math.fround(Math.cos(P.yaw)), s = Math.fround(Math.sin(P.yaw)), d = P.dim;
  const ix = (x) => Math.min(d - 1, Math.max(0, Math.floor(x * d)));
  const samp = (x, y, z) => vox[(ix(z) * d + ix(y)) * d + ix(x)] / 255;
  const q = (x) => Math.floor(Math.min(1, Math.max(0, x)) * 255 + 0.5);
  for (let py = 0; py < P.h; py++) for (let px = 0; px < P.w; px++) {
    const u = (px + 0.5) / P.w * 2 - 1, v = (py + 0.5) / P.h * 2 - 1;
    const ox = 0.5 + c * u * 0.9 - s * 2, oy = 0.5 - v * 0.9, oz = 0.5 - s * u * 0.9 - c * 2;
    const slab = (o, d) => { if (Math.abs(d) < 1e-6) return o < 0 || o > 1 ? [1e30, -1e30] : [-1e30, 1e30]; const a = (0 - o) / d, b = (1 - o) / d; return [Math.min(a, b), Math.max(a, b)]; };
    const sx = slab(ox, s), sz = slab(oz, c), tmin = Math.max(sx[0], sz[0]), tmax = Math.min(sx[1], sz[1]);
    let r = 0, g = 0, b = 0, al = 0;
    if (oy >= 0 && oy <= 1 && tmax > Math.max(tmin, 0)) {
      const dt = (tmax - tmin) / P.steps;
      if (P.style === 1) { let m = 0; for (let k = 0; k < P.steps; k++) { const t = tmin + (k + 0.5) * dt; m = Math.max(m, samp(ox + s * t, oy, oz + c * t)); } r = g = b = m; al = 1; }
      else {
        let a = 0;
        for (let k = 0; k < P.steps; k++) {
          const t = tmin + (k + 0.5) * dt, sv = samp(ox + s * t, oy, oz + c * t), A = Math.min(1, Math.max(0, (sv - P.thr) * P.gain)) * P.stepAlpha, w = (1 - a) * A;
          r += w * sv; g += w * sv * 0.6; b += w * (1 - sv); a += w; if (a > 0.99) break;
        }
        al = a;
      }
    }
    const o = (py * P.w + px) * 4; out[o] = q(r); out[o + 1] = q(g); out[o + 2] = q(b); out[o + 3] = q(al);
  }
  return out;
}
/* how many pixels' rays enter the unit cube (the others never march); same slab logic as the kernel */
export function marched(P) {
  const c = Math.fround(Math.cos(P.yaw)), s = Math.fround(Math.sin(P.yaw)); let n = 0;
  const slab = (o, d) => { if (Math.abs(d) < 1e-6) return o < 0 || o > 1 ? [1e30, -1e30] : [-1e30, 1e30]; const a = (0 - o) / d, b = (1 - o) / d; return [Math.min(a, b), Math.max(a, b)]; };
  for (let py = 0; py < P.h; py++) for (let px = 0; px < P.w; px++) {
    const u = (px + 0.5) / P.w * 2 - 1, v = (py + 0.5) / P.h * 2 - 1, ox = 0.5 + c * u * 0.9 - s * 2, oy = 0.5 - v * 0.9, oz = 0.5 - s * u * 0.9 - c * 2, sx = slab(ox, s), sz = slab(oz, c);
    if (oy >= 0 && oy <= 1 && Math.min(sx[1], sz[1]) > Math.max(sx[0], sz[0], 0)) n++;
  }
  return n;
}
/* a volume that is non-zero up to every face (a ramp with a checker), so first/last-sample and clamp errors change pixels */
export function rampVolume(d) { const v = new Uint8Array(d * d * d); for (let z = 0; z < d; z++) for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) v[(z * d + y) * d + x] = 24 + ((x * 3 + y * 5 + z * 7) % 200) + (((x ^ y ^ z) & 4) ? 8 : 0); return v; }
/* procedural volume: a hollow shell plus one lobe, deterministic; fills the fixture (dim 8) and the bench volumes (dim 64..256) */
export function makeVolume(d) {
  const v = new Uint8Array(d * d * d);
  for (let z = 0; z < d; z++) for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const X = (x + 0.5) / d - 0.5, Y = (y + 0.5) / d - 0.5, Z = (z + 0.5) / d - 0.5, r = Math.hypot(X, Y, Z);
    const shell = Math.exp(-Math.pow((r - 0.32) / 0.05, 2)), lobe = Math.exp(-(Math.pow(X - 0.12, 2) + Math.pow(Y + 0.1, 2) + Math.pow(Z, 2)) / 0.006) * 0.9;
    v[(z * d + y) * d + x] = Math.min(255, Math.round(255 * Math.max(shell, lobe)));
  }
  return v;
}
/* X3D fixture -> {dim, vox, style}: VolumeData + PixelTexture3D (image = "w h d comp v..." decimal ints) + OpacityMapVolumeStyle | ProjectionVolumeStyle type=MAX */
export function fromX3D(doc) {
  const t = doc.getElementsByTagName('PixelTexture3D')[0]; if (!t) throw new Error('fixture needs PixelTexture3D');
  const a = t.getAttribute('image').trim().split(/\s+/).map(Number), [comp, w, h, d] = a;   // X3D / the shared reader: components width height depth, then the voxels
  if (w !== h || h !== d || comp !== 1) throw new Error('kernel takes cubic 1-component volumes');
  const vox = Uint8Array.from(a.slice(4)); if (vox.length !== w * h * d) throw new Error('voxel count mismatch');
  const vd = doc.getElementsByTagName('VolumeData')[0]; if (!vd) throw new Error('fixture needs VolumeData');
  for (const c of vd.children) if (!['OpacityMapVolumeStyle', 'ProjectionVolumeStyle', 'PixelTexture3D'].includes(c.tagName)) throw new Error(`${c.tagName} is not supported (gap)`);
  const mip = doc.getElementsByTagName('ProjectionVolumeStyle')[0]; if (mip && (mip.getAttribute('type') || 'MAX') !== 'MAX') throw new Error('ProjectionVolumeStyle type other than MAX is a gap');
  if (doc.getElementsByTagName('OpacityMapVolumeStyle')[0]?.getElementsByTagName('*').length) throw new Error('a transfer function child is not supported (the kernel uses a fixed ramp)');
  return { dim: w, vox, style: mip ? 1 : 0 };
}
