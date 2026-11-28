// One descent of one line: the snowpack settles under gravity, then a skier crosses it (a moving line load of
// 780 N/m, Fohn's skier), or the patroller's charge goes off first. If the snow under the skier starts to run,
// the skier is caught and becomes a rigid disc carried by the debris (79.5 kg per metre of width); pulling the
// airbag grows the disc, which lowers its density. The game, the bots and the level tests all use this class.

import { sliceSim, SKIER_R } from './level.js';
import { G } from './mpm.js';

export const SETTLE = 1.5;

export class Run {
  constructor(level, o = {}) {
    this.level = level;
    this.o = { line: 1, mode: 'ski', soften: 0.01, toe: 'foot', speed: 6, chargeDv: 4, chargeR: 2, airbag: false, airbagR: 0.55, waitAfterCharge: 8, tune: {}, ...o };
    this.sim = sliceSim(level, { line: this.o.line, tune: this.o.tune, dx: o.dx, toe: this.o.toe });
    const M = this.sim.meta;
    // the patrol bot skis only once the released debris has come to rest (slab mean speed < 0.2 m/s for 1 s)
    this.skier = { x: M.snowX[0] + 0.5, y: 0, state: 'waiting', start: this.o.mode === 'patrol' ? Infinity : SETTLE, buried: null };
    if (this.o.mode === 'idle') this.skier.state = 'none';
    this.charge = this.o.mode === 'patrol' ? { x: M.pitchX[0], at: SETTLE, done: false } : null; // at the top of the roll, so nothing hangs above
    this.events = [];
    this.maxRunning = 0; // largest fraction of the pitch's slab displaced more than 0.5 m since SETTLE
    this.slabCount = 0;
    for (let p = 0; p < this.sim.n; p++) if (this.sim.mat[p] === 0) this.slabCount++;
    this.end = M.pitchX[1] + 4;
  }

  /** Live snow surface at x: the highest particle within half a cell. */
  surface(x) {
    const S = this.sim, h = S.dx / 2;
    let top = S.meta.groundAt(x);
    for (let p = 0; p < S.n; p++) if (Math.abs(S.x[p] - x) < h && S.y[p] > top) top = S.y[p];
    return top;
  }

  /** Fraction of the pitch's slab (as it sat at SETTLE) that has since moved more than 0.5 m. */
  moved() {
    const S = this.sim, H = this.home; let k = 0;
    for (let i = 0; i < H.length; i += 3) { const p = H[i]; if ((S.x[p] - H[i + 1]) ** 2 + (S.y[p] - H[i + 2]) ** 2 > 0.25) k++; }
    return k / (H.length / 3);
  }

  log(what) { this.events.push({ t: +this.sim.t.toFixed(3), what }); }

  /** Advance n solver steps, updating the skier, the charge and the detectors every few steps. */
  advance(n) {
    const S = this.sim, sk = this.skier;
    for (let k = 0; k < n; k++) {
      if (!this.sintered && S.t >= SETTLE) {
        // the pack has settled: the weak layer's bonds form in this geometry (sintering), and from now on plastic
        // shear breaks them (strain softening). Plastic shear from the settling itself does not count.
        this.sintered = true;
        S.mats[1].soften = this.o.soften;
        for (let p = 0; p < S.n; p++) if (S.mat[p] === 1) S.dmg[p] = 0;
        // where the slab sat when it settled: release is judged by how far the pitch's slab has moved from here
        const [a, b] = S.meta.pitchX;
        this.home = [];
        for (let p = 0; p < S.n; p++) if (S.mat[p] === 0 && S.x[p] > a && S.x[p] < b) this.home.push(p, S.x[p], S.y[p]);
      }
      if (this.charge && !this.charge.done && S.t >= this.charge.at) {
        const y = this.surface(this.charge.x);
        S.blast(this.charge.x, y, this.o.chargeR, this.o.chargeDv);
        this.charge.done = true; this.log(`charge at x ${this.charge.x.toFixed(1)} m`);
      }
      if (sk.state === 'waiting' && S.t >= sk.start) { sk.state = 'skiing'; this.log('skier drops in'); }
      if (sk.state === 'skiing') {
        sk.x += this.o.speed * S.dt;
        if (S.steps % 8 === 0) sk.y = this.surface(sk.x);
        S.loads = [{ x: sk.x, y: sk.y - S.dx * 0.5, fx: 0, fy: -SKIER_R }];
        if (sk.x >= this.end) { sk.state = 'out'; S.loads = []; this.log('skier out at the bottom'); }
      }
      S.step();
      if (S.steps % 10 === 0 && this.home) {
        const r = this.moved();
        if (r > this.maxRunning) this.maxRunning = r;
        if (r >= 0.5 && !this.released) { this.released = S.t; this.log(`slab released (${(r * 100).toFixed(0)}% of the pitch's slab has moved 0.5 m)`); }
        if (sk.state === 'skiing') {
          let m = 0, v = 0;
          for (let p = 0; p < S.n; p++) { if (S.mat[p] !== 0) continue; const d = Math.hypot(S.x[p] - sk.x, S.y[p] - sk.y); if (d < 1.5) { m++; v += Math.hypot(S.vx[p], S.vy[p]); } }
          // caught = carried by real debris: at least 0.3 m^2 (per metre of width) of slab within 1.5 m, moving
          // faster than 0.5 m/s on average; a few cm of sluff under the skis does not count
          if (m * S.v0[0] >= 0.3 && v / m > 0.5) {
            sk.state = 'caught'; S.loads = [];
            S.body = { x: sk.x, y: sk.y + 0.3, vx: this.o.speed, vy: 0, r: 0.3, M: SKIER_R / G };
            this.caughtAt = S.t; this.log('skier caught');
          }
        }
        if (this.o.mode === 'patrol' && sk.state === 'waiting' && this.released) {
          let m = 0, v = 0;
          for (let p = 0; p < S.n; p++) if (S.mat[p] === 0) { m++; v += Math.hypot(S.vx[p], S.vy[p]); }
          if (v / m < 0.2) { this.calm = this.calm ?? S.t; if (S.t - this.calm >= 1) { sk.start = S.t; this.log('debris at rest: the patroller drops in'); } } else this.calm = null;
        }
        if (sk.state === 'caught') {
          if (this.o.airbag && S.body.r < this.o.airbagR && S.t > this.caughtAt + 0.3) { S.body.r = this.o.airbagR; this.log('airbag out'); }
          sk.x = S.body.x; sk.y = S.body.y;
        }
      }
    }
  }

  /** Depth of the caught skier's top below the debris surface (m; negative = on top). */
  burial() {
    if (!this.sim.body) return null;
    const B = this.sim.body;
    return +(this.surface(B.x) - (B.y + B.r)).toFixed(3);
  }

  runTo(t) { const n = Math.ceil((t - this.sim.t) / this.sim.dt); if (n > 0) this.advance(n); return this; }

  summary() {
    return { line: this.level.lines[this.o.line].name, mode: this.o.mode, t: +this.sim.t.toFixed(2), released: this.released ?? false, max_moved: +this.maxRunning.toFixed(3),
      skier: this.skier.state, caught_at: this.caughtAt ?? null, burial_m: this.burial(), events: this.events };
  }
}
