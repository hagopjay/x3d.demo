// Sampling the vocabulary. Keys are in beats; easing between keys follows the
// move's Laban Effort: sudden (time > 0) snaps toward the next key, sustained
// (time < 0) glides; keys marked `hit` always land with a snap.

export function mirrorPose(p) {
  const out = {};
  for (const [j, v] of Object.entries(p)) {
    if (j === "root") { out.root = [-v[0], v[1], v[2], -v[3]]; continue; }
    const m = j.startsWith("l_") ? "r_" + j.slice(2) : j.startsWith("r_") ? "l_" + j.slice(2) : j;
    out[m] = [v[0], -v[1], -v[2]];
  }
  return out;
}

export class Library {
  constructor(lib) {
    this.lib = lib;
    this.moves = lib.moves;
    this.byId = Object.fromEntries(lib.moves.map((m) => [m.id, m]));
    const mr = (r) => r && { l: r.r && [-r.r[0], r.r[1], r.r[2]], r: r.l && [-r.l[0], r.l[1], r.l[2]], w: r.w };
    this.mirrored = Object.fromEntries(lib.moves.map((m) => [m.id, m.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose), reach: mr(k.reach) }))]));
  }
  get(id) { return this.byId[id]; }
}

function ease(u, time, hit) {
  // time in [-1,1]: map to an exponent; hits get a sharp ease-out
  if (hit) return 1 - Math.pow(1 - u, 3 + 2 * Math.max(0, time));
  const s = u * u * (3 - 2 * u); // smoothstep baseline
  if (time > 0) return (1 - time) * s + time * (1 - Math.pow(1 - u, 4));
  return (1 + time) * s + -time * (0.5 - 0.5 * Math.cos(Math.PI * s));
}

/** Pose at beat offset t (0..beats) for a move; returns {pose, root}. */
export function sample(library, move, t, mirror = false, scale = 1) {
  const keys = mirror ? library.mirrored[move.id] : move.keys;
  const T = Math.min(Math.max(t, 0), move.beats);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= T) i++;
  const a = keys[i], b = keys[i + 1] ?? keys[i];
  const span = b.t - a.t || 1;
  const u = ease((T - a.t) / span, move.effort.time, !!b.hit);
  const pose = {}, root = [0, 0, 0, 0];
  const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  for (const j of names) {
    const va = a.pose[j] ?? (j === "root" ? [0, 0, 0, 0] : [0, 0, 0]);
    const vb = b.pose[j] ?? (j === "root" ? [0, 0, 0, 0] : [0, 0, 0]);
    const v = va.map((x, k) => (x + (vb[k] - x) * u) * (j === "root" && k === 3 ? 1 : scale));
    if (j === "root") root.splice(0, 4, ...v);
    else pose[j] = v;
  }
  // hand reach: interpolate targets; weight eases in/out where keys lack it
  let reach = null;
  if (a.reach || b.reach) {
    const side = (s) => {
      const pa = a.reach?.[s], pb = b.reach?.[s];
      if (!pa && !pb) return undefined;
      const A = pa ?? pb, B = pb ?? pa;
      return A.map((x, k) => x + (B[k] - x) * u);
    };
    const wa = a.reach?.w ?? 0, wb = b.reach?.w ?? 0;
    reach = { l: side("l"), r: side("r"), w: (wa + (wb - wa) * u) * scale };
  }
  return { pose, root, reach };
}

/** Weighted sum of layers {pose, root, w}. */
export function blend(layers) {
  const pose = {}, root = [0, 0, 0, 0];
  for (const L of layers) {
    if (!L || !L.w) continue;
    for (const [j, v] of Object.entries(L.pose)) {
      const o = (pose[j] ||= [0, 0, 0]);
      o[0] += v[0] * L.w; o[1] += v[1] * L.w; o[2] += v[2] * L.w;
    }
    for (let k = 0; k < 4; k++) root[k] += (L.root?.[k] ?? 0) * (k === 3 ? (L.yawW ?? L.w) : L.w);
  }
  return { pose, root };
}
