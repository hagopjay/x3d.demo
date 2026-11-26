// SPDX-License-Identifier: GPL-3.0-or-later
// Wire Lab v3 light: packets, glow and the geometry they ride. Canvas 2D, additive blending.
// A packet exists only because Hub.launch() was called for a real event (or for one replayed from a recording, on the ghost lane).

export const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
export const mix = (hex, other, t) => { const a = rgb(hex), b = rgb(other); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
export const lift = (hex, t = .45) => mix(hex, '#ffffff', t);

// A path sampled into points with cumulative length, so a packet can be placed at any distance along it.
export function samplePath(fn, n = 48) {
  const pts = [], cum = [0];
  for (let i = 0; i <= n; i++) { const [x, y] = fn(i / n); pts.push(x, y); if (i) cum.push(cum[i - 1] + Math.hypot(x - pts[2 * i - 2], y - pts[2 * i - 1])); }
  return { pts, cum, len: cum[n] };
}
export function pointAt(path, s) {
  const { pts, cum } = path, n = cum.length - 1;
  s = Math.max(0, Math.min(path.len, s));
  let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const span = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / span;
  const x = pts[2 * lo] + (pts[2 * hi] - pts[2 * lo]) * t, y = pts[2 * lo + 1] + (pts[2 * hi + 1] - pts[2 * lo + 1]) * t;
  const dx = pts[2 * hi] - pts[2 * lo], dy = pts[2 * hi + 1] - pts[2 * lo + 1], d = Math.hypot(dx, dy) || 1;
  return [x, y, dx / d, dy / d];
}
export function strokePath(ctx, path, from = 0, to = path.len) {
  const a = pointAt(path, from); ctx.moveTo(a[0], a[1]);
  const { cum, pts } = path; for (let i = 0; i < cum.length; i++) if (cum[i] > from && cum[i] < to) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  const b = pointAt(path, to); ctx.lineTo(b[0], b[1]);
}

const ease = u => u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;      // ease in and out for single events
export class Hub {
  constructor(opts = {}) {
    this.packets = []; this.cap = opts.cap ?? 120; this.gap = opts.gap ?? 95; this.travel = opts.travel ?? 720;
    this.hold = new Map(); this.lastSpawn = new Map(); this.glow = new Map(); this.heat = new Map();
    this.reduced = opts.reduced ?? false; this.launched = 0;
  }
  clear() { this.packets = []; this.hold.clear(); this.lastSpawn.clear(); this.glow.clear(); this.heat.clear(); }
  // a real event left `node` for `to`
  pulse(node, to, colour, now, lane = 'live') {
    const g = this.glow; const key = lane + '|' + node;
    g.set(key, { at: now, colour, amp: 1 });
    if (to) g.set(lane + '|' + to, { at: now, colour, amp: .42 });
  }
  glowOf(node, now, lane = 'live') { const g = this.glow.get(lane + '|' + node); if (!g) return null; const v = g.amp * Math.exp(-(now - g.at) / 300); return v < .02 ? null : { v, colour: g.colour }; }
  heatOf(index, now, lane = 'live') { const h = this.heat.get(lane + '|' + index); if (!h) return 0; const v = Math.exp(-(now - h) / 420); return v < .02 ? 0 : v; }
  // events that have not become a packet yet (counts), turned into packets no faster than one per `gap` ms per wire
  feed(pairs, now, lane = 'live') { for (const [index, n] of pairs) { const k = lane + '|' + index; this.hold.set(k, (this.hold.get(k) || 0) + n); this.heat.set(k, now); } }
  step(now, typeOf, rateOf) {
    for (const [k, n] of this.hold) {
      const last = this.lastSpawn.get(k) ?? -1e9;
      if (n > 0 && now - last >= this.gap) {
        const [lane, idx] = k.split('|'), index = +idx;
        this.packets.push({ lane, index, born: now, dur: this.travel, count: n, type: typeOf(index), rate: rateOf ? rateOf(index) : 1 });
        this.hold.set(k, 0); this.lastSpawn.set(k, now); this.launched++;
        if (this.packets.length > this.cap) this.packets.shift();
      }
    }
    this.packets = this.packets.filter(p => now - p.born < p.dur);
    return this.packets;
  }
  position(p, now) { const u = Math.max(0, Math.min(1, (now - p.born) / p.dur)); return p.rate >= 6 ? u : ease(u); }
}

// Draw packets on a path provider: pathOf(index) -> path or null. unit = 1 / view scale, so line widths stay constant on screen.
export function drawPackets(ctx, hub, now, pathOf, colourOf, unit = 1, lane = 'live', offset = 0) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const p of hub.packets) {
    if (p.lane !== lane) continue;
    const path = pathOf(p.index); if (!path || !path.len) continue;
    const colour = colourOf(p.type), u = hub.reduced ? .5 : hub.position(p, now), fade = hub.reduced ? 1 - (now - p.born) / p.dur : 1;
    const s = u * path.len, speed = path.len / (p.dur / 1000), trail = Math.min(path.len * .6, Math.max(14 * unit, speed * .16));
    const dense = p.rate >= 6, big = 1 + Math.min(.6, Math.log2(p.count) * .16), ghost = lane !== 'live';
    const at = ss => { const q = pointAt(path, ss); return offset ? [q[0] - q[3] * offset * unit, q[1] + q[2] * offset * unit] : [q[0], q[1]]; };
    const s0 = Math.max(0, s - trail), steps = 16;
    for (let i = 0; i < steps; i++) {      // tail: one smooth taper, thin and dim at the end, brightening towards the head
      const a = at(s0 + (s - s0) * i / steps), b = at(s0 + (s - s0) * (i + 1) / steps), f = (i + 1) / steps;
      ctx.strokeStyle = rgba(colour, (ghost ? .3 : dense ? .42 : .8) * Math.pow(f, 1.7) * fade); ctx.lineWidth = (.6 + 2.6 * f) * unit * (ghost ? .75 : big * .85);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const h = at(s), r = (ghost ? 8 : dense ? 7 : 12) * unit * big;
    const grad = ctx.createRadialGradient(h[0], h[1], 0, h[0], h[1], r);
    grad.addColorStop(0, rgba(lift(colour, .6), (ghost ? .45 : .9) * fade)); grad.addColorStop(.3, rgba(colour, (ghost ? .2 : dense ? .3 : .42) * fade)); grad.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(h[0], h[1], r, 0, 6.283); ctx.fill();
    if (ghost) { ctx.strokeStyle = rgba(lift(colour, .5), .9 * fade); ctx.lineWidth = 1.4 * unit; ctx.beginPath(); ctx.arc(h[0], h[1], 4.2 * unit, 0, 6.283); ctx.stroke(); }
    else { ctx.fillStyle = `rgba(255,255,255,${.95 * fade})`; ctx.beginPath(); ctx.arc(h[0], h[1], (dense ? 1.7 : 2.3) * unit * Math.min(big, 1.4), 0, 6.283); ctx.fill(); }
  }
  ctx.restore();
}

// A soft glow (bloom falloff from stacked radial gradients) at a point.
export function bloom(ctx, x, y, radius, colour, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(colour, a)); g.addColorStop(.35, rgba(colour, a * .38)); g.addColorStop(.7, rgba(colour, a * .08)); g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, radius, 0, 6.283); ctx.fill(); ctx.restore();
}
