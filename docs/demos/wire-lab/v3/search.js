// SPDX-License-Identifier: GPL-3.0-or-later
// "The graph wires itself": plays a RECORDED search (x3d.selfcode.trace/1) as ghost wirings. Nothing here searches or runs a
// simulator; every number shown is read from the recording file.
import { rgba, lift, bloom } from './fx.js';

const GHOST = '#c9a6ff', LOCK = '#9ef275', GREY = '#9a93b0';

// What a visitor can load: the winner's nodes and ROUTEs must be expressible in this page's catalogue and world.
export function planWinner(Graph, cat, worldGraph, winner) {
  const g = new Graph(cat, worldGraph), alias = {}, add = [];
  for (const n of winner.nodes) {
    if (n.parent) {
      const mine = [...g.nodes.values()].find(m => m.parent === n.parent && m.type === n.type && m.role === 'behaviour');
      if (!mine) return { ok: false, reason: `no ${n.type} in ${n.parent} in this world` };
      alias[n.id] = mine.id;
    } else if (!cat.isBehaviour(n.type)) return { ok: false, reason: `${n.type} is not in this page's catalogue` };
    else add.push(n);
  }
  const id = i => alias[i] || i;
  for (const r of winner.routes) for (const e of [r[0], r[2]]) if (!alias[e] && !add.some(n => n.id === e) && !g.nodes.has(e)) return { ok: false, reason: `${e} is not a node of this world` };
  for (const n of add) { try { g.add(n.type, n.id); } catch (e) { return { ok: false, reason: e.message }; } }
  for (const r of winner.routes) { const p = g.problem(id(r[0]), r[1], id(r[2]), r[3]); if (p) return { ok: false, reason: `${r.join(' ')}: ${p[0]}` }; }
  return { ok: true, alias, add, routes: winner.routes.map(r => [id(r[0]), r[1], id(r[2]), r[3]]) };
}

export class Search {
  constructor({ canvas, trace, cat, world, colours, reduced, onStep }) {
    Object.assign(this, { canvas, trace, cat, world, colours, reduced, onStep });
    this.n = trace.candidates.length; this.k = 0; this.shown = []; this.playing = false; this.timer = 0; this.born = 0; this.prev = null; this.raf = 0;
    this.ctx = canvas.getContext('2d'); this.models = new Map();
    this.worldType = Object.fromEntries(world.graph.nodes.map(n => [n.id, n.type]));
  }
  cand() { return this.k ? this.trace.candidates[this.k - 1] : null; }
  runs() { const c = this.cand(); return c ? c.runs_so_far : 0; }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect(), d = Math.min(3, window.devicePixelRatio || 1);
    this.W = Math.max(280, Math.round(r.width)); this.H = 180;
    this.canvas.width = Math.round(this.W * d); this.canvas.height = Math.round(this.H * d);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(d, 0, 0, d, 0, 0); this.models.clear(); this.paint(performance.now());
  }
  // One candidate laid out alone: sources on the left, scene targets on the right, the rest by longest path.
  model(i) {
    if (this.models.has(i)) return this.models.get(i);
    const c = i === 'win' ? { nodes: this.trace.winner.nodes, routes: this.trace.winner.routes, verdict: 'match' } : this.trace.candidates[i - 1];
    const nodes = new Map(); for (const n of c.nodes) if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, type: n.type, kind: 'made' });
    for (const r of c.routes) for (const e of [r[0], r[2]]) if (!nodes.has(e)) nodes.set(e, { id: e, type: this.worldType[e] || '?', kind: 'scene' });
    for (const n of nodes.values()) if (n.type === 'TouchSensor') n.kind = 'sensor';
    const depth = new Map([...nodes.keys()].map(k => [k, 0]));
    for (let it = 0; it < nodes.size; it++) for (const r of c.routes) if (r[0] !== r[2]) depth.set(r[2], Math.max(depth.get(r[2]), Math.min(depth.get(r[0]) + 1, nodes.size)));
    let top = 0; for (const [k, n] of nodes) if (n.kind !== 'scene') top = Math.max(top, depth.get(k));
    for (const [k, n] of nodes) { if (n.kind === 'scene') depth.set(k, top + 1); if (n.kind === 'sensor') depth.set(k, 0); }
    const cols = Math.max(...depth.values()) + 1, byCol = [...Array(cols)].map(() => []);
    for (const [k, n] of nodes) byCol[depth.get(k)].push(n);
    const L = 64, R = this.W - 64, T = 34, B = this.H - 50;
    byCol.forEach((list, ci) => list.forEach((n, ri) => { n.x = cols === 1 ? (L + R) / 2 : L + (R - L) * ci / (cols - 1); n.y = list.length === 1 ? (T + B) / 2 : T + (B - T) * ri / (list.length - 1); }));
    const routes = c.routes.map(r => { let t = '?'; try { t = this.cat.resolve(nodes.get(r[0]).type, r[1], 'out')[1]; } catch {} return { r, a: nodes.get(r[0]), b: nodes.get(r[2]), col: this.colours[t] || GREY, type: t }; });
    const m = { nodes: [...nodes.values()], routes, verdict: c.verdict }; this.models.set(i, m); return m;
  }
  // Labels go on the first of four rows (below, above, further below, further above) where they touch no other label and stay inside.
  placeLabels(ctx, list) {
    const boxes = []; ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'top';
    const hit = (p, q) => !(p.x1 < q.x0 || p.x0 > q.x1 || p.y1 < q.y0 || p.y0 > q.y1);
    for (const { nd, a } of list.slice().sort((p, q) => p.nd.x - q.nd.x)) {
      let name = nd.id, pick = null;
      for (const pass of [0, 1]) { if (pass) name = nd.id.length > 9 ? nd.id.slice(0, 8) + '…' : nd.id;
        const w = ctx.measureText(name).width + 4, x0 = Math.max(4, Math.min(this.W - 4 - w, nd.x - w / 2));
        for (const dy of [11, -25, 27, -41]) { const q = { x0, x1: x0 + w, y0: nd.y + dy, y1: nd.y + dy + 14 }; if (q.y0 < 4 || q.y1 > this.H - 32 || boxes.some(p => hit(p, q))) continue; pick = { ...q, name, id: nd.id }; break; }
        if (pick) break; }
      if (!pick) { const w = ctx.measureText(name).width + 4; pick = { x0: nd.x - w / 2, x1: nd.x + w / 2, y0: nd.y + 11, y1: nd.y + 25, name, id: nd.id }; }
      boxes.push(pick); ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(9,8,14,.85)'; ctx.strokeText(pick.name, pick.x0 + 2, pick.y0); ctx.fillStyle = rgba('#f1ecff', Math.min(1, .45 + .55 * Math.min(1, a))); ctx.fillText(pick.name, pick.x0 + 2, pick.y0);
    }
    this.boxes = boxes;
  }
  labelBoxes() { return { boxes: (this.boxes || []).map(b => ({ id: b.id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })), W: this.W, H: this.H }; }
  drawnIds() { return this.k ? this.model(this.k).nodes.map(n => n.id) : []; }
  setStep(k, how = 'play') {
    k = Math.max(0, Math.min(this.n, k | 0));
    this.prev = this.k ? { k: this.k, at: this.born } : null; this.k = k; this.born = performance.now();
    if (k) this.shown.push(k);
    if (this.onStep) this.onStep(k);
    this.kick();
  }
  play(ms) {
    this.pause(); if (this.k >= this.n) this.setStep(0); this.playing = true;
    const tick = () => { if (!this.playing) return; if (this.k >= this.n) { this.pause(); return; } this.setStep(this.k + 1); if (this.k >= this.n) { this.playing = false; if (this.onStep) this.onStep(this.k); return; } this.timer = setTimeout(tick, ms); };
    tick();
  }
  pause() { this.playing = false; clearTimeout(this.timer); }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); }); }
  frame(now) {
    const n = this.paint(performance.now());
    if (n && !this.reduced) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); });
  }
  env(verdict, age) {
    if (this.reduced) return verdict === 'match' ? 1 : .8;
    const rise = Math.min(1, age / 140);
    return verdict === 'match' ? rise * (1 + .3 * Math.exp(-age / 420)) : rise * (.2 + .8 * Math.exp(-age / 650));
  }
  // returns true while something is still fading
  paint(now) {
    const ctx = this.ctx, W = this.W, H = this.H; if (!W) return false;
    ctx.clearRect(0, 0, W, H);
    // history strip: one tick per candidate, ghost for ran, green for the match, the current one lifted
    const n = this.n, x0 = 18, x1 = W - 18, y = H - 14, step = (x1 - x0) / Math.max(1, n);
    for (let i = 1; i <= n; i++) {
      const v = this.trace.candidates[i - 1].verdict, past = i <= this.k, cur = i === this.k, x = x0 + step * (i - .5);
      ctx.fillStyle = v === 'match' ? rgba(LOCK, past ? 1 : .5) : rgba(GHOST, cur ? 1 : past ? .55 : .16);
      ctx.fillRect(x - Math.max(.5, step * .32), y - (cur ? 9 : v === 'match' ? 8 : 5), Math.max(1, step * .64), cur ? 18 : v === 'match' ? 16 : 10);
    }
    let busy = false;
    const drawModel = (i, age, verdict, mul) => {
      const m = this.model(i), a = this.env(verdict, age) * mul; if (a <= .012) return;
      if (age < 2600 && !this.reduced) busy = true;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const q of m.routes) {
        const x1 = q.a.x + 9, y1 = q.a.y, x2 = q.b.x - 9, y2 = q.b.y, dx = Math.max(34, Math.abs(x2 - x1) * .5);
        const path = () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2); };
        for (const [w, al, c] of [[8, .09, q.col], [3.6, .3, q.col], [1.5, .95, lift(q.col, .5)]]) { path(); ctx.lineWidth = w; ctx.strokeStyle = rgba(c, Math.min(1, al * a)); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x2, y2, 2.4, 0, 6.283); ctx.fillStyle = rgba(lift(q.col, .6), Math.min(1, a)); ctx.fill();
      }
      ctx.restore();
      const labelOf = [];
      for (const nd of m.nodes) {
        const col = verdict === 'match' ? LOCK : nd.kind === 'scene' ? '#57dbf5' : nd.kind === 'sensor' ? '#e9cf8a' : GHOST;
        bloom(ctx, nd.x, nd.y, 22, col, Math.min(.9, .5 * a));
        const g = ctx.createRadialGradient(nd.x - 2.5, nd.y - 3, .5, nd.x, nd.y, 8.5);
        g.addColorStop(0, rgba(lift(col, .7), Math.min(1, .35 + a))); g.addColorStop(.6, rgba(col, Math.min(1, .25 + .7 * a))); g.addColorStop(1, rgba(col, Math.min(1, .12 + .3 * a)));
        ctx.beginPath(); ctx.arc(nd.x, nd.y, 7.5, 0, 6.283); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(lift(col, .75), Math.min(1, .4 + .5 * a)); ctx.stroke();
        if (mul === 1) labelOf.push({ nd, a });
      }
      if (mul === 1) this.placeLabels(ctx, labelOf);
    };
    if (this.prev && !this.reduced) { const age = now - this.born + 0; drawModel(this.prev.k, now - this.prev.at + (now - this.born > 0 ? 0 : 0), this.trace.candidates[this.prev.k - 1].verdict, Math.max(0, .22 * (1 - Math.min(1, (now - this.born) / 500)))); }
    const c = this.cand();
    if (c) drawModel(this.k, now - this.born, c.verdict, 1);
    else { ctx.fillStyle = rgba('#f1ecff', .5); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('press Watch the search wire it', W / 2, H / 2 - 14); }
    return busy;
  }
}
