// SPDX-License-Identifier: GPL-3.0-or-later
// Wire Lab v3 event accounting. No DOM, no X_ITE in this file, so node can test it (build/test_core.mjs).
// Everything here is fed by ONE call: Flow.record(...), made from a field callback that X_ITE really invoked.
// Nothing in this file creates an event, replays one or smooths one into existence: every number is a count of callbacks.

export class Flow {
  // routes: [{ index, from, ff, to, tf, type }]   (ff / tf are the field names as written in the ROUTE)
  constructor(opts = {}) {
    this.keep = opts.keep ?? 4000;        // log length kept (counts are exact whatever the log length)
    this.streamLines = opts.streamLines ?? 16;
    this.continuousGap = opts.continuousGap ?? 350;    // ms: a wire that fires faster than this is a "continuous stream"
    this.reset([]);
  }
  reset(routes, wall = 0) {
    this.routes = routes.map(r => ({ ...r }));
    this.generation = (this.generation || 0) + 1;
    this.loadedAt = wall;
    this.total = 0; this.seq = 0; this.log = []; this.stream = []; this.streamVersion = (this.streamVersion || 0) + 1;
    this.wires = this.routes.map(() => ({ count: 0, times: [], last: null, lastWall: -1e9, lastT: 0, firstSeq: 0 }));
    this.nodes = new Map();
    for (const r of this.routes) for (const id of [r.from, r.to]) if (!this.nodes.has(id)) this.nodes.set(id, { in: 0, out: 0, lastOut: -1e9, lastIn: -1e9, type: r.type });
    this.window = [];                      // wall times of the last second, for events per second
    this.group = null; this.deepest = 0; this.sharing = 0; this.groups = 0;
    this.pending = new Map();              // route index -> events not yet turned into a packet
    this.marker = { generation: this.generation, routes: this.routes.length, wall };
  }
  // One real event. t: X3D time (browser.getCurrentTime()), wall: performance.now(), value: already a string.
  record(index, t, wall, value) {
    const r = this.routes[index], w = this.wires[index];
    if (!r || !w) return null;
    this.total++; this.seq++; w.count++; if (!w.firstSeq) w.firstSeq = this.seq; w.last = value; w.lastWall = wall; w.lastT = t;
    w.times.push(wall); if (w.times.length > 600) w.times.splice(0, w.times.length - 600);
    const a = this.nodes.get(r.from), b = this.nodes.get(r.to);
    a.out++; a.lastOut = wall; a.type = r.type; b.in++; b.lastIn = wall;
    this.window.push(wall); while (this.window.length && this.window[0] < wall - 1000) this.window.shift();
    const entry = { seq: this.seq, t, wall, index, from: r.from, ff: r.ff, to: r.to, tf: r.tf, type: r.type, value };
    this.log.push(entry); if (this.log.length > this.keep) this.log.splice(0, this.log.length - this.keep);
    this.pending.set(index, (this.pending.get(index) || 0) + 1);
    this._cascade(r, t);
    this._stream(entry, w);
    return entry;
  }
  // events that share one X3D timestamp, and the largest connected group of them (nodes joined by the wires that fired)
  _cascade(r, t) {
    if (!this.group || this.group.t !== t) { this.group = { t, n: 0, parent: new Map(), size: new Map() }; this.groups++; }
    const g = this.group, find = x => { while (g.parent.get(x) !== x) { g.parent.set(x, g.parent.get(g.parent.get(x))); x = g.parent.get(x); } return x; };
    for (const id of [r.from, r.to]) if (!g.parent.has(id)) { g.parent.set(id, id); g.size.set(id, 0); }
    const ra = find(r.from), rb = find(r.to);
    let root = ra;
    if (ra !== rb) { g.parent.set(rb, ra); g.size.set(ra, g.size.get(ra) + g.size.get(rb)); }
    g.size.set(root, g.size.get(root) + 1); g.n++;
    if (g.size.get(root) > this.deepest) this.deepest = g.size.get(root);
    if (g.n > this.sharing) this.sharing = g.n;
  }
  _stream(e, w) {
    const prevGap = w.times.length > 1 ? e.wall - w.times[w.times.length - 2] : 1e9;
    const top = this.stream[0];
    const row = this.stream.find(x => x.index === e.index && x.continuous);
    if (prevGap < this.continuousGap) {
      if (row) { row.count++; row.value = e.value; row.t = e.t; row.wall = e.wall; this.stream.splice(this.stream.indexOf(row), 1); this.stream.unshift(row); }
      else {
        // the wire has just become a stream: fold its recent discrete lines into one line
        this.stream = this.stream.filter(x => !(x.index === e.index && !x.continuous));
        this.stream.unshift({ index: e.index, continuous: true, count: 2, t: e.t, wall: e.wall, type: e.type, from: e.from, ff: e.ff, to: e.to, tf: e.tf, value: e.value, since: e.wall });
      }
    } else {
      if (row) row.ended = true;   // the stream paused: its line stays, a new discrete line starts above it
      this.stream.unshift({ index: e.index, continuous: false, count: 1, t: e.t, wall: e.wall, type: e.type, from: e.from, ff: e.ff, to: e.to, tf: e.tf, value: e.value });
    }
    void top;
    if (this.stream.length > this.streamLines) this.stream.length = this.streamLines;
    this.streamVersion++;
  }
  // x60/s style rate of a stream line: events in the last 1000 ms of that wire
  rate(index, wall) { const w = this.wires[index]; let n = 0; for (let i = w.times.length - 1; i >= 0 && w.times[i] >= wall - 1000; i--) n++; return n; }
  perSecond(wall) { while (this.window.length && this.window[0] < wall - 1000) this.window.shift(); return this.window.length; }
  activeRoutes(wall, span = 5000) { return this.wires.filter(w => w.lastWall >= wall - span).length; }
  // counts of one wire in `bins` slices of `binMs`, newest last (the sparkline of the last 5 s)
  spark(index, wall, bins = 25, binMs = 200) {
    const out = new Array(bins).fill(0), w = this.wires[index];
    for (let i = w.times.length - 1; i >= 0; i--) { const age = wall - w.times[i]; if (age >= bins * binMs) break; if (age >= 0) out[bins - 1 - Math.floor(age / binMs)]++; }
    return out;
  }
  // the packets the views should launch: one per wire with news, carrying how many events it stands for
  takePending() { const out = [...this.pending]; this.pending.clear(); return out; }
}

// Compact value for the stream: numbers to 2 decimals, long text cut.
export function compact(v, max = 30) {
  const s = String(v).replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  const nums = parts.map(Number);
  const text = parts.length && nums.every(x => !Number.isNaN(x) && x !== '') && s !== ''
    ? parts.map((p, i) => { const x = nums[i]; return Math.abs(x) >= 1e8 ? x.toExponential(2).replace('+', '') : String(+x.toFixed(2)); }).join(' ') : s;
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
