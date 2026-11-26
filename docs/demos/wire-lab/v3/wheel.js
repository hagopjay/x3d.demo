// SPDX-License-Identifier: GPL-3.0-or-later
// Wire Lab v3 flywheel view: the same ROUTE graph drawn as hoops. Every feedback cycle (strongly connected component) is a
// luminous hoop with its nodes as glass beads on the rim; nodes outside a cycle feed into or out of the hoops; a graph with no
// cycle is one open arc ("a pipeline, not yet a wheel"). Layout is computed when the graph or the size changes, never per frame.
import { components, simpleCycles, layout } from './wirelab.js';
import { samplePath, pointAt, strokePath, rgba, lift, mix, drawPackets, bloom } from './fx.js';

const TAU = Math.PI * 2, FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---- layout (pure: graph + size in, positions and paths out) ----------------------------------------------------------
export function buildWheel(graph, cat, w, h) {
  const wired = new Set(graph.routes.flatMap(r => [r[0], r[2]]).filter(i => graph.nodes.has(i)));
  const { cyclic, out } = components(graph);
  const hoopsAll = cyclic.slice().sort((a, b) => b.length - a.length), hoops = hoopsAll.slice(0, 4);
  const st = new Map(), model = { w, h, mode: hoops.length ? 'wheel' : 'pipeline', hoops: [], stations: st, wires: [], omitted: hoopsAll.length - hoops.length, unwired: graph.nodes.size - wired.size };
  const reach = (starts, next) => { const seen = new Set(starts), q = [...starts]; while (q.length) { const v = q.shift(); for (const x of next(v)) if (!seen.has(x)) { seen.add(x); q.push(x); } } return seen; };
  const inn = new Map([...graph.nodes.keys()].map(i => [i, new Set()])); for (const [a, set] of out) for (const b of set) inn.get(b)?.add(a);
  const place = (id, x, y, kind, extra = {}) => st.set(id, { id, x, y, kind, r: kind === 'rim' ? 13 : 11, depth: .5, ...extra });

  if (!hoops.length) {
    const pos = layout(graph, 1, 1), ids = [...wired], cols = {};
    ids.forEach(id => (cols[pos[id][0]] ||= []).push(id));
    const keys = Object.keys(cols).map(Number).sort((a, b) => a - b), C = keys.length;
    const R = Math.max(w * .8, 520), cx = w / 2, th = Math.min(.55, Math.asin(Math.min(.95, (w * .4) / R))), cy = h * .4 + R;
    model.arc = { cx, cy, R, from: -th - .09, to: th + .09 };
    keys.forEach((k, ci) => {
      const phi = C === 1 ? 0 : -th + 2 * th * ci / (C - 1), m = cols[k].length;
      cols[k].forEach((id, j) => { const rr = R + (j - (m - 1) / 2) * 62; place(id, cx + rr * Math.sin(phi), cy - rr * Math.cos(phi), 'arc', { depth: .6 }); });
    });
    const pointOf = id => st.get(id);
    graph.routes.forEach((r, index) => { const a = pointOf(r[0]), b = pointOf(r[2]); if (a && b) model.wires.push({ index, path: bez(a, b, 0), kind: 'pipe' }); });
    model.caption = `A pipeline, not yet a wheel: ${graph.routes.length} ROUTE${graph.routes.length === 1 ? '' : 's'} run one way from the first node to the last and no event can come back round. Wire an output back to an earlier input and a hoop appears.`;
    return model;
  }

  // wheel mode
  const inHoop = new Map(); hoops.forEach((c, i) => c.forEach(id => inHoop.set(id, i)));
  const hoopIds = new Set([...inHoop.keys()]);
  const up = reach([...hoopIds], v => inn.get(v)), down = reach([...hoopIds], v => out.get(v));
  const feeds = [...wired].filter(id => !hoopIds.has(id) && up.has(id)), outs = [...wired].filter(id => !hoopIds.has(id) && down.has(id) && !up.has(id)), side = [...wired].filter(id => !hoopIds.has(id) && !up.has(id) && !down.has(id));
  const PCOL = 112, PROW = 62, TOP = 14 + 28 * hoops.length, rowsMax = Math.max(3, Math.floor((h - TOP - 52) / PROW));
  const depthOf = ids => { const set = new Set(ids), d = new Map(ids.map(i => [i, 0])); for (let k = 0; k < ids.length; k++) for (const r of graph.routes) if (set.has(r[0]) && set.has(r[2]) && r[0] !== r[2]) d.set(r[2], Math.max(d.get(r[2]), d.get(r[0]) + 1)); return d; };
  // a band of nodes outside the hoops: columns in rank order, as few columns as the height allows, no column wider than a label
  const pack = ids => { const d = depthOf(ids), sorted = ids.slice().sort((a, b) => d.get(a) - d.get(b)), nc = Math.max(1, Math.ceil(sorted.length / rowsMax)), per = Math.ceil(sorted.length / nc), cols = [];
    for (let k = 0; k < sorted.length; k += per) cols.push(sorted.slice(k, k + per)); return cols; };
  const fCols = feeds.length ? pack(feeds) : [], oCols = outs.length ? pack(outs) : [];
  const bandL = fCols.length ? fCols.length * PCOL + 24 : 36, bandR = oCols.length ? oCols.length * PCOL + 24 : 36;
  const x0 = bandL, x1 = w - bandR, slot = (x1 - x0) / hoops.length, BOT = 46, cyAll = TOP + (h - TOP - BOT) / 2;
  hoops.forEach((comp, hi) => {
    const cyc = simpleCycles(graph, comp, 60), longest = cyc.cycles.slice().sort((a, b) => b.length - a.length)[0] || comp;
    const order = longest.slice();
    for (const id of comp) if (!order.includes(id)) { const k = order.findIndex(p => graph.routes.some(r => r[0] === p && r[2] === id)); order.splice(k < 0 ? order.length : k + 1, 0, id); }
    const n = order.length, cx = x0 + slot * (hi + .5), cy = cyAll, FLAT = .56;
    const R = Math.max(80, Math.min(slot / 2 - 40, ((h - TOP - BOT) / 2 - 30) / FLAT)), ry = R * FLAT, tilt = -.14, ct = Math.cos(tilt), sn = Math.sin(tilt);
    const ell = th => { const x = R * Math.cos(th), y = ry * Math.sin(th); return [cx + x * ct - y * sn, cy + x * sn + y * ct]; };
    const hoop = { index: hi, nodes: order, cx, cy, R, ry, tilt, ell, cycles: cyc.cycles.length, capped: cyc.capped, theta: new Map() };
    // turn the ring so stations that take feeds sit on the left and stations that feed outputs sit on the right
    const inPull = id => graph.routes.some(r => r[2] === id && (feeds.includes(r[0]) || side.includes(r[0]))), outPull = id => graph.routes.some(r => r[0] === id && (outs.includes(r[2]) || side.includes(r[2])));
    let spin = 0, best = 1e9;
    for (let k = 0; k < 72; k++) { const rot = TAU * k / 72; let cost = 0;
      order.forEach((id, i) => { const th = Math.PI / 2 + rot + TAU * i / n, ip = inPull(id), op = outPull(id), c = Math.cos(th);
        if (ip && op) cost += 2 * Math.abs(c) + Math.abs(Math.sin(th)) * -.2; else if (ip) cost += c; else if (op) cost += -c; });
      if (cost < best - 1e-9) { best = cost; spin = rot; } }
    order.forEach((id, i) => { const th = Math.PI / 2 + spin + TAU * i / n; hoop.theta.set(id, th); const [x, y] = ell(th); place(id, x, y, 'rim', { hoop: hi, theta: th, depth: .5 + .5 * Math.sin(th), r: 14 + 3.5 * Math.sin(th) }); });
    model.hoops.push(hoop);
  });
  // feed and output bands: columns fan out on a gentle arc around the hoops, rows spread over the free height
  const band = (cols, xStart, kind, dir) => cols.forEach((col, c) => { const m = col.length, cxx = xStart + PCOL * (c + .5), pitch = Math.min(112, (h - TOP - BOT - 24) / Math.max(1, m));
    col.forEach((id, k) => { const tt = m === 1 ? 0 : (2 * k / (m - 1) - 1), stagger = (c % 2 ? 1 : -1) * (m < rowsMax ? pitch * .22 : 0);
      place(id, cxx + dir * -tt * tt * 20, cyAll + tt * pitch * (m - 1) / 2 + stagger, kind, { depth: .55 }); }); });
  band(fCols, 12, 'feed', -1); band(oCols, w - bandR + 12, 'out', 1);
  if (side.length) side.forEach((id, i) => place(id, w * .12 + (w * .76) * (i + .5) / side.length, h - 70, 'side'));
  graph.routes.forEach((r, index) => {
    const a = st.get(r[0]), b = st.get(r[2]); if (!a || !b) return;
    if (a.kind === 'rim' && b.kind === 'rim' && a.hoop === b.hoop) {
      const hoop = model.hoops[a.hoop], n = hoop.nodes.length, i = hoop.nodes.indexOf(r[0]), j = hoop.nodes.indexOf(r[2]);
      if (r[0] === r[2]) { model.wires.push({ index, path: loop(a, hoop), kind: 'self', hoop: a.hoop }); return; }
      if ((i + 1) % n === j) { const ta = hoop.theta.get(r[0]); let tb = hoop.theta.get(r[2]); if (tb <= ta) tb += TAU; model.wires.push({ index, path: samplePath(u => hoop.ell(ta + (tb - ta) * u), 36), kind: 'rim', hoop: a.hoop }); return; }
      model.wires.push({ index, path: chord(a, b, hoop), kind: 'chord', hoop: a.hoop }); return;
    }
    model.wires.push({ index, path: bez(a, b, 0, a.kind === 'rim' ? outward(a, model.hoops[a.hoop]) : null, b.kind === 'rim' ? outward(b, model.hoops[b.hoop]) : null), kind: a.kind === 'rim' || b.kind === 'rim' ? 'feed' : 'pipe' });
  });
  for (const r of graph.routes) { const a = st.get(r[0]), b = st.get(r[2]); if (a && b && a.kind === 'rim' && (b.kind !== 'rim' || a.hoop !== b.hoop)) a.external = true; if (a && b && b.kind === 'rim' && (a.kind !== 'rim' || a.hoop !== b.hoop)) b.external = true; }
  const total = model.hoops.length;
  model.caption = `${total} feedback ${total === 1 ? 'hoop' : 'hoops'}: ${model.hoops.map(hp => `${hp.nodes.length} stations, ${hp.cycles}${hp.capped ? '+' : ''} simple ${hp.cycles === 1 ? 'cycle' : 'cycles'}`).join('; ')}. Packets circle a hoop only when X_ITE really sends events round it.`;
  return model;
}
function chord(a, b, hoop) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, c = [hoop.cx + (mx - hoop.cx) * .22, hoop.cy + (my - hoop.cy) * .22];
  return samplePath(u => { const v = 1 - u; return [v * v * a.x + 2 * v * u * c[0] + u * u * b.x, v * v * a.y + 2 * v * u * c[1] + u * u * b.y]; }, 32);
}
function loop(a, hoop) {
  const ox = a.x - hoop.cx, oy = a.y - hoop.cy, d = Math.hypot(ox, oy) || 1, nx = ox / d, ny = oy / d, cx = a.x + nx * 30, cy = a.y + ny * 30;
  return samplePath(u => [cx + 22 * Math.cos(TAU * u + Math.atan2(-ny, -nx)), cy + 22 * Math.sin(TAU * u + Math.atan2(-ny, -nx))], 32);
}
const outward = (a, hoop) => { const dx = a.x - hoop.cx, dy = a.y - hoop.cy, d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
function bez(a, b, bend, na, nb) {
  const d = Math.max(60, Math.abs(b.x - a.x) * .5, na || nb ? 90 : 0), sx = b.x >= a.x ? 1 : -1;
  if (!na && !nb && Math.abs(b.x - a.x) < 40) { const sy = b.y >= a.y ? 1 : -1, dy = Math.max(30, Math.abs(b.y - a.y) * .4); const c1 = [a.x, a.y + sy * dy], c2 = [b.x, b.y - sy * dy];
    return samplePath(u => { const v = 1 - u; return [v * v * v * a.x + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b.x, v * v * v * a.y + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b.y]; }, 40); }
  const c1 = na ? [a.x + na[0] * d, a.y + na[1] * d] : [a.x + sx * d, a.y + bend], c2 = nb ? [b.x + nb[0] * d, b.y + nb[1] * d] : [b.x - sx * d, b.y + bend];
  return samplePath(u => { const v = 1 - u; return [v * v * v * a.x + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b.x, v * v * v * a.y + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b.y]; }, 40);
}

// ---- drawing ----------------------------------------------------------------------------------------------------------
export class Wheel {
  constructor(canvas, env) { this.canvas = canvas; this.env = env; this.model = null; this.static = document.createElement('canvas'); this.dpr = 1; this.dirty = true; }
  // env: { graph, cat, colours, flow, hub, ghost: {flow}, typeOf(index), selected() }
  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(box.width)), h = Math.max(100, Math.round(box.height));
    if (this.canvas.width !== Math.round(w * this.dpr) || this.canvas.height !== Math.round(h * this.dpr)) { this.canvas.width = this.static.width = Math.round(w * this.dpr); this.canvas.height = this.static.height = Math.round(h * this.dpr); }
    this.w = w; this.h = h; this.rebuild();
  }
  rebuild() {
    if (!this.w) return;
    const { graph, cat } = this.env; this.model = buildWheel(graph, cat, this.w, this.h); this.paths = new Map(this.model.wires.map(wr => [wr.index, wr.path]));
    this.paintStatic(); this.dirty = true;
  }
  colour(index) { return this.env.colours[this.env.typeOf(index)] || '#aaa'; }
  paintStatic() {
    const ctx = this.static.getContext('2d'), m = this.model, { graph } = this.env, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    // floor glow
    const bg = ctx.createRadialGradient(this.w / 2, this.h * .46, 0, this.w / 2, this.h * .46, Math.max(this.w, this.h) * .62);
    bg.addColorStop(0, 'rgba(34,28,46,.55)'); bg.addColorStop(1, 'rgba(8,7,12,0)'); ctx.fillStyle = bg; ctx.fillRect(0, 0, this.w, this.h);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (m.arc) {      // the open arc of a pipeline
      const { cx, cy, R, from, to } = m.arc, a0 = -Math.PI / 2 + from, a1 = -Math.PI / 2 + to;
      for (const [wd, al] of [[22, .03], [13, .05], [7, .1], [3.2, .22], [1.3, .75]]) { const g = ctx.createLinearGradient(cx + R * Math.sin(from), 0, cx + R * Math.sin(to), 0); g.addColorStop(0, rgba('#57dbf5', al)); g.addColorStop(.5, rgba('#e9cf8a', al)); g.addColorStop(1, rgba('#9ef275', al)); ctx.strokeStyle = g; ctx.lineWidth = wd; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke(); }
    }
    for (const hoop of m.hoops) {
      const { cx, cy, R } = hoop, seg = 240;
      const halo = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.55); halo.addColorStop(0, 'rgba(233,207,138,.05)'); halo.addColorStop(.7, 'rgba(233,207,138,.03)'); halo.addColorStop(1, 'rgba(233,207,138,0)'); ctx.fillStyle = halo; ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);
      const hs = Math.min(1.6, R / 150);
      for (const [wd, al] of [[40, .02], [26, .035], [15, .06], [8, .11], [3.6, .26], [1.5, .75]]) for (let i = 0; i < seg; i++) {     // the rim, far side dimmer and thinner
        const t0 = TAU * i / seg, t1 = TAU * (i + 1) / seg, depth = .5 + .5 * Math.sin((t0 + t1) / 2), k = .14 + .86 * depth * depth;
        const a = hoop.ell(t0), b = hoop.ell(t1); ctx.lineCap = 'butt'; ctx.strokeStyle = rgba('#e9cf8a', al * k); ctx.lineWidth = wd * hs * (.38 + .62 * depth); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      // the inner twin: where the Blender lane rides (a dashed, cooler hoop)
      ctx.setLineDash([3, 7]); ctx.strokeStyle = rgba('#c9a6ff', .38); ctx.lineWidth = 1.1; ctx.beginPath();
      for (let i = 0; i <= 72; i++) { const p = hoop.ell(TAU * i / 72); const f = .8, q = [hoop.cx + (p[0] - hoop.cx) * f, hoop.cy + (p[1] - hoop.cy) * f]; i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.stroke(); ctx.setLineDash([]);
    }
    // wires: halo, then a bright core, in the colour of the field type, dim at the source and bright at the target
    for (const wr of m.wires) {
      const col = this.colour(wr.index), path = wr.path, a = pointAt(path, 0), b = pointAt(path, path.len);
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, rgba(col, .42)); g.addColorStop(1, rgba(lift(col, .25), .95));
      const rim = wr.kind === 'rim';
      ctx.strokeStyle = rgba(col, rim ? .12 : .09); ctx.lineWidth = rim ? 9 : 7; ctx.beginPath(); strokePath(ctx, path); ctx.stroke();
      ctx.strokeStyle = g; ctx.lineWidth = rim ? 2.2 : 1.8; ctx.beginPath(); strokePath(ctx, path); ctx.stroke();
    }
    ctx.restore();
    // stations: glass beads and labels
    for (const s of m.stations.values()) this.bead(ctx, s, 0);
    this.labels(ctx);
    // hoop captions
    void graph;
  }
  bead(ctx, s, glow, colour) {
    const node = this.env.graph.nodes.get(s.id), base = colour || (node?.role === 'target' ? '#57dbf5' : '#e9cf8a'), r = s.r * (.85 + .3 * s.depth);
    const g = ctx.createRadialGradient(s.x - r * .35, s.y - r * .4, r * .1, s.x, s.y, r);
    g.addColorStop(0, rgba(lift(base, .85), .98)); g.addColorStop(.35, rgba(lift(base, .2), .9)); g.addColorStop(1, rgba(mix(base, '#08070c', .62), .96));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(lift(base, .55), .5 + .4 * s.depth + glow * .4); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();        // rim highlight
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(s.x, s.y, r * .72, Math.PI * 1.08, Math.PI * 1.55); ctx.stroke();   // glint
  }
  // Labels are placed one by one, hoop stations first, on the first spot where they touch no other label, no bead and no wire
  // end: full label (name and type) beside the bead, then name only, then pushed outward on a short leader line. A name-only
  // label shows its type when the pointer is over the bead.
  labels(ctx) {
    const m = this.model, placed = [{ x0: 4, y0: 2, x1: this.w - 4, y1: 8 + 28 * m.hoops.length }, { x0: 0, y0: this.h - 44, x1: this.w, y1: this.h }], all = [...m.stations.values()].sort((a, b) => (b.kind === 'rim') - (a.kind === 'rim'));
    const cross = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
    ctx.lineJoin = 'round';
    const wirePts = []; for (const wr of m.wires) for (let d = 0; d <= wr.path.len; d += 9) wirePts.push(pointAt(wr.path, d));
    for (const wr of m.wires) { const p = pointAt(wr.path, wr.path.len * (wr.kind === 'chord' ? .3 : .5)); placed.push({ x0: p[0] - 18, y0: p[1] - 10, x1: p[0] + 18, y1: p[1] + 10 }); }      // wire count badges
    for (const s of all) {
      const node = this.env.graph.nodes.get(s.id), type = node ? node.type : '';
      ctx.font = `600 12px ${FONT}`; const w1 = ctx.measureText(s.id).width; ctx.font = `11px ${FONT}`; const wt = ctx.measureText(type).width;
      let ux = 0, uy = 1;                                                   // outward unit vector: away from the hoop centre, or down
      if (s.kind === 'rim') { const hp = m.hoops[s.hoop]; ux = s.x - hp.cx; uy = s.y - hp.cy; if (s.external) { ux = -ux; uy = -uy; } const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d; }
      else if (s.kind === 'feed') { ux = -1; uy = 0; } else if (s.kind === 'out') { ux = 1; uy = 0; }
      const pref = s.kind === 'rim' ? (Math.abs(ux) * .8 > Math.abs(uy) ? (ux > 0 ? 'r' : 'l') : (uy > 0 ? 'b' : 't')) : 'b';
      const sides = [pref, ...['b', 't', 'r', 'l'].filter(k => k !== pref), 'br', 'bl', 'tr', 'tl'];
      const rectOf = (k, w, h, push) => { const r = s.r + 7 + push, px = s.x + ux * push, py = s.y + uy * push;
        return k === 'b' ? { x0: px - w / 2, y0: py + r, x1: px + w / 2, y1: py + r + h, a: 'c' } : k === 't' ? { x0: px - w / 2, y0: py - r - h, x1: px + w / 2, y1: py - r, a: 'c' }
        : k === 'r' ? { x0: px + r, y0: py - h / 2, x1: px + r + w, y1: py + h / 2, a: 'l' } : k === 'l' ? { x0: px - r - w, y0: py - h / 2, x1: px - r, y1: py + h / 2, a: 'r' }
        : k === 'br' ? { x0: px + r * .7, y0: py + r * .7, x1: px + r * .7 + w, y1: py + r * .7 + h, a: 'l' } : k === 'bl' ? { x0: px - r * .7 - w, y0: py + r * .7, x1: px - r * .7, y1: py + r * .7 + h, a: 'r' }
        : k === 'tr' ? { x0: px + r * .7, y0: py - r * .7 - h, x1: px + r * .7 + w, y1: py - r * .7, a: 'l' } : { x0: px - r * .7 - w, y0: py - r * .7 - h, x1: px - r * .7, y1: py - r * .7, a: 'r' }; };
      const onWire = q => wirePts.some(p => p[0] > q.x0 - 2 && p[0] < q.x1 + 2 && p[1] > q.y0 - 2 && p[1] < q.y1 + 2 && Math.hypot(p[0] - s.x, p[1] - s.y) > s.r + 9);
      const free = q => q.x0 >= 4 && q.x1 <= this.w - 4 && q.y0 >= 4 && q.y1 <= this.h - 4 && !placed.some(p => cross(p, q)) && !onWire(q) &&
        !all.some(o => o !== s && cross({ x0: o.x - o.r - 3, y0: o.y - o.r - 3, x1: o.x + o.r + 3, y1: o.y + o.r + 3 }, q));
      let pick = null, compact = false, push = 0;
      for (const [cmp, ps] of [[false, 0], [true, 0], [false, 24], [true, 24], [true, 48], [true, 72]]) {
        const w = (cmp ? w1 : Math.max(w1, wt)) + 2, h = cmp ? 15 : 27;
        for (const k of sides) { const q = rectOf(k, w, h, ps); if (free(q)) { pick = q; compact = cmp; push = ps; break; } }
        if (pick) break;
      }
      if (!pick) { pick = rectOf(pref, w1 + 2, 15, 0); compact = true; }
      placed.push(pick); s.compact = compact; s.typeText = type;
      if (push) { ctx.strokeStyle = 'rgba(233,207,138,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x + ux * (s.r + 2), s.y + uy * (s.r + 2)); ctx.lineTo(s.x + ux * (s.r + push), s.y + uy * (s.r + push)); ctx.stroke(); }
      const tx = pick.a === 'c' ? (pick.x0 + pick.x1) / 2 : pick.a === 'l' ? pick.x0 : pick.x1;
      ctx.textAlign = pick.a === 'c' ? 'center' : pick.a === 'l' ? 'left' : 'right'; ctx.strokeStyle = 'rgba(8,7,12,.92)'; ctx.lineWidth = 4;
      const ty = compact ? pick.y0 + 11 : pick.y0 + 11;
      ctx.font = `600 12px ${FONT}`; ctx.strokeText(s.id, tx, ty); ctx.fillStyle = '#efe9de'; ctx.fillText(s.id, tx, ty);
      if (!compact) { ctx.font = `11px ${FONT}`; ctx.strokeText(type, tx, pick.y0 + 24); ctx.fillStyle = '#b9b2a5'; ctx.fillText(type, tx, pick.y0 + 24); }
    }
  }
  hit(x, y) { if (!this.model) return null; let best = null, bd = 18 * 18; for (const s of this.model.stations.values()) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s.id; } } return best; }
  // one frame. Returns true when something was drawn that will change next frame (a packet or a decaying glow)
  draw(now) {
    const ctx = this.canvas.getContext('2d'), { hub, flow, graph } = this.env, dpr = this.dpr, m = this.model;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.drawImage(this.static, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!m) return false;
    let live = false;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const wr of m.wires) {      // a wire that just carried an event brightens and decays
      const heat = hub.heatOf(wr.index, now), gh = hub.heatOf(wr.index, now, 'ghost'), col = this.colour(wr.index);
      if (heat) { live = true; ctx.strokeStyle = rgba(col, .12 * heat); ctx.lineWidth = 12; ctx.beginPath(); strokePath(ctx, wr.path); ctx.stroke(); ctx.strokeStyle = rgba(lift(col, .3), .55 * heat); ctx.lineWidth = 3.4; ctx.beginPath(); strokePath(ctx, wr.path); ctx.stroke(); }
      if (gh) { live = true; ctx.strokeStyle = rgba('#c9a6ff', .4 * gh); ctx.lineWidth = 2.5; ctx.beginPath(); strokePath(ctx, wr.path); ctx.stroke(); }
    }
    for (const hoop of m.hoops) {      // the hoop breathes with the real events on its own wires
      let a = 0; for (const wr of m.wires) if (wr.hoop === hoop.index) a = Math.max(a, hub.heatOf(wr.index, now));
      if (a) { live = true; bloom(ctx, hoop.cx, hoop.cy, hoop.R * 1.25, '#e9cf8a', .16 * a); }
    }
    ctx.restore();
    for (const s of m.stations.values()) {
      const gl = hub.glowOf(s.id, now), gg = hub.glowOf(s.id, now, 'ghost');
      if (gl) { live = true; bloom(ctx, s.x, s.y, 46, gl.colour, .8 * gl.v); this.bead(ctx, s, gl.v, gl.colour); }
      if (gg) { live = true; bloom(ctx, s.x, s.y, 34, '#c9a6ff', .5 * gg.v); }
      if (this.env.selected() === s.id) { ctx.strokeStyle = '#ffc752'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 6, 0, TAU); ctx.stroke(); }
    }
    const pathOf = i => this.paths.get(i), colourOf = t => this.env.colours[t] || '#aaa';
    drawPackets(ctx, hub, now, pathOf, colourOf, 1, 'live'); drawPackets(ctx, hub, now, pathOf, () => '#c9a6ff', 1, 'ghost', 8);
    if (hub.packets.length) live = true;
    const hv = this.hoverId && m.stations.get(this.hoverId);
    if (hv) { const txt = `${hv.id} · ${hv.typeText || this.env.graph.nodes.get(hv.id)?.type || ''}`; ctx.font = `600 12px ${FONT}`; const wd = ctx.measureText(txt).width + 16, x = Math.max(6, Math.min(this.w - wd - 6, hv.x - wd / 2)), y = Math.max(6, hv.y - hv.r - 34);
      ctx.fillStyle = 'rgba(10,9,15,.92)'; ctx.strokeStyle = 'rgba(233,207,138,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, wd, 22, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#efe9de'; ctx.textAlign = 'left'; ctx.fillText(txt, x + 8, y + 15); }
    // counts on the wires (what the page has really received so far)
    ctx.textAlign = 'center'; ctx.font = `600 11px ${MONO}`;
    for (const wr of m.wires) { const n = flow.wires[wr.index]?.count || 0; if (!n) continue; const p = pointAt(wr.path, wr.path.len * (wr.kind === 'chord' ? .3 : .5)), t = String(n), wd = ctx.measureText(t).width + 10;
      ctx.fillStyle = 'rgba(10,9,15,.82)'; ctx.strokeStyle = rgba(this.colour(wr.index), .7); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(p[0] - wd / 2, p[1] - 8, wd, 16, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#efe9de'; ctx.fillText(t, p[0], p[1] + 4); }
    // the hoop list: which stations, how many simple cycles, how many real events on the hoop's own wires
    ctx.textAlign = 'left'; let ly = 16;
    for (const hoop of m.hoops) {
      const ev = m.wires.filter(wr => wr.hoop === hoop.index).reduce((t, wr) => t + (flow.wires[wr.index]?.count || 0), 0);
      const line = `HOOP ${hoop.index + 1}   ${hoop.nodes.join(' → ')} ↺   ${hoop.cycles}${hoop.capped ? '+' : ''} simple cycle${hoop.cycles === 1 ? '' : 's'}   ${ev.toLocaleString('en-US')} events on its wires`;
      ctx.font = `600 11px ${MONO}`; const wd = ctx.measureText(line).width + 20;
      ctx.fillStyle = 'rgba(10,9,15,.78)'; ctx.strokeStyle = 'rgba(233,207,138,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(10, ly - 13, Math.min(wd, this.w - 20), 22, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9cf8a'; ctx.fillText(line, 20, ly + 2); ly += 28; }
    this.dirty = false;
    return live;
  }
}
