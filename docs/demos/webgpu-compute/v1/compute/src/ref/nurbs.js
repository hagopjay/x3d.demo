/* CPU reference for nurbs.wgsl. Deliberately a DIFFERENT algorithm: the recursive Cox-de Boor definition of N_{i,p}(u) and its derivative, evaluated in f64,
   so a bug in the shader's A2.2 / derivative shortcut cannot also be in the check. Knot rule = the bridge's: a vector that is not dim+order long, or decreases, is replaced by the pinned uniform one. */
export function knotsFor(dim, order, given) {
  const len = dim + order; let k = given && given.length === len ? given.slice() : null;
  if (k) for (let i = 1; i < len; i++) if (k[i - 1] > k[i]) k = null;
  if (k) { let same = 0; for (let i = 1; i < len; i++) { same = k[i] === k[i - 1] ? same + 1 : 0; if (same > order - 1) k = null; } }
  if (!k) { k = []; let i = 0, v = 1; for (; i < order; i++) k[i] = 0; for (const l = len - order; i < l; i++, v++) k[i] = v; for (; i < len; i++) k[i] = v; const m = k[len - 1]; k = k.map((x) => x / m); }
  return k;
}
const N = (i, p, u, k) => { if (p === 0) return (k[i] <= u && u < k[i + 1]) ? 1 : 0; let s = 0; const a = k[i + p] - k[i], b = k[i + p + 1] - k[i + 1]; if (a > 0) s += (u - k[i]) / a * N(i, p - 1, u, k); if (b > 0) s += (k[i + p + 1] - u) / b * N(i + 1, p - 1, u, k); return s; };
const dN = (i, p, u, k) => { let s = 0; const a = k[i + p] - k[i], b = k[i + p + 1] - k[i + 1]; if (a > 0) s += p / a * N(i, p - 1, u, k); if (b > 0) s -= p / b * N(i + 1, p - 1, u, k); return s; };
export function tessellate(S) {
  const { du, dv, pu, pv, ku, kv, ctrl, nu, nv } = S, P = new Float32Array(nu * nv * 4), Nn = new Float32Array(nu * nv * 4);
  const u0 = ku[pu], u1 = ku[du], v0 = kv[pv], v1 = kv[dv], eps = 1e-9;
  for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
    let u = u0 + (u1 - u0) * iu / (nu - 1), v = v0 + (v1 - v0) * iv / (nv - 1);
    /* the half-open span rule puts u = last knot outside every span; evaluate the limit from the left, like the shader's clamped span */
    const uu = iu === nu - 1 ? u1 - eps : u, vv = iv === nv - 1 ? v1 - eps : v;
    let A = [0, 0, 0], Au = [0, 0, 0], Av = [0, 0, 0], W = 0, Wu = 0, Wv = 0;
    for (let j = 0; j < dv; j++) { const nvj = N(j, pv, vv, kv), dvj = dN(j, pv, vv, kv); if (!nvj && !dvj) continue;
      for (let i = 0; i < du; i++) { const nui = N(i, pu, uu, ku), dui = dN(i, pu, uu, ku); if (!nui && !dui) continue;
        const c = ctrl[j * du + i], w = c[3];
        for (let d = 0; d < 3; d++) { A[d] += c[d] * w * nui * nvj; Au[d] += c[d] * w * dui * nvj; Av[d] += c[d] * w * nui * dvj; }
        W += w * nui * nvj; Wu += w * dui * nvj; Wv += w * nui * dvj; } }
    const Sx = A.map((x) => x / W), Su = Au.map((x, d) => (x - Sx[d] * Wu) / W), Sv = Av.map((x, d) => (x - Sx[d] * Wv) / W);
    const n = [Su[1] * Sv[2] - Su[2] * Sv[1], Su[2] * Sv[0] - Su[0] * Sv[2], Su[0] * Sv[1] - Su[1] * Sv[0]], l = Math.hypot(...n), o = (iv * nu + iu) * 4;
    P.set([Sx[0], Sx[1], Sx[2], 1], o); Nn.set(l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l, 0] : [0, 0, 0, 0], o);
  }
  return { P, N: Nn };
}
/* X3D fixture -> patches. Reads NurbsPatchSurface: uDimension vDimension uOrder vOrder (default 3) uKnot vKnot weight uTessellation vTessellation (tessellation rule of 19775-1 27.3.1)
   and its controlPoint Coordinate. uClosed / vClosed (periodic) is a gap and is refused. */
export function fromX3D(doc) {
  const nums = (s) => (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number), out = [];
  for (const e of doc.getElementsByTagName('NurbsPatchSurface')) {
    if (e.getAttribute('uClosed') === 'true' || e.getAttribute('vClosed') === 'true') continue;   // gap: periodic knot layout
    const du = +e.getAttribute('uDimension'), dv = +e.getAttribute('vDimension'), ou = +(e.getAttribute('uOrder') || 3), ov = +(e.getAttribute('vOrder') || 3);
    if (du < ou || dv < ov || ou > 6 || ov > 6 || ou < 2 || ov < 2) continue;
    const cp = nums([...e.children].find((c) => c.getAttribute('containerField') === 'controlPoint')?.getAttribute('point')); if (cp.length !== du * dv * 3) continue;
    let wt = nums(e.getAttribute('weight')); if (wt.length !== du * dv) wt = Array(du * dv).fill(1);
    const tess = (t, dim) => (t > 0 ? t : t < 0 ? -t * dim : 2 * dim), tu = tess(+(e.getAttribute('uTessellation') || 0), du), tv = tess(+(e.getAttribute('vTessellation') || 0), dv);
    out.push({ def: e.getAttribute('DEF'), du, dv, pu: ou - 1, pv: ov - 1, ku: knotsFor(du, ou, nums(e.getAttribute('uKnot'))), kv: knotsFor(dv, ov, nums(e.getAttribute('vKnot'))), ctrl: Array.from({ length: du * dv }, (_, i) => [cp[i * 3], cp[i * 3 + 1], cp[i * 3 + 2], wt[i]]), nu: tu + 1, nv: tv + 1 });
  }
  return out;
}
/* pack a patch for the shader */
export function pack(S) {
  const knots = new Float32Array([...S.ku, ...S.kv]), ctrl = new Float32Array(S.ctrl.flat()), u = new Uint32Array([S.nu, S.nv, S.du, S.dv, S.pu, S.pv, 0, 0, 0, S.ku.length, 0, 0]);
  return { knots, ctrl, uniform: u };
}
/* synthetic bench patch: dim x dim control net, order 4 (cubic), pinned uniform knots, mild rational weights, gently curved */
export function bench(dim, nu, nv = nu) {
  const ctrl = []; for (let j = 0; j < dim; j++) for (let i = 0; i < dim; i++) ctrl.push([i, j, 1.5 * Math.sin(i * 0.9) * Math.cos(j * 0.7), 1 + 0.3 * Math.sin(i + j)]);
  return { du: dim, dv: dim, pu: 3, pv: 3, ku: knotsFor(dim, 4), kv: knotsFor(dim, 4), ctrl, nu, nv };
}
