// Listening: pure DSP, shared by the AudioWorklet and node tests.
// Hop 256 samples (~5.8 ms at 44.1 kHz). Three bands (kick / snare-ish / hats)
// give onset strengths; Tempo finds period and phase from the onset envelope;
// Meter measures syncopation and bar phase; Sections flags big changes.

const TAU = Math.PI * 2;

function fftMag(re, im) { // in-place radix-2 FFT, returns nothing (re/im overwritten)
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export class BandOnsets {
  /** Log-magnitude spectral flux in three bands (kick / body / air). */
  constructor(sampleRate, hop = 256, size = 1024) {
    this.sr = sampleRate; this.hop = hop; this.size = size; this.fps = sampleRate / hop;
    this.buf = new Float32Array(size); this.fill = 0; this.since = 0;
    this.win = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    this.re = new Float32Array(size); this.im = new Float32Array(size);
    this.prev = new Float32Array(size / 2);
    const bin = (f) => Math.round((f * size) / sampleRate);
    this.bands = { low: [bin(30), bin(150)], mid: [bin(150), bin(2500)], high: [bin(5000), Math.min(size / 2 - 1, bin(16000))] };
  }
  process(samples) {
    const out = [];
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.fill] = samples[i];
      this.fill = (this.fill + 1) % this.size;
      if (++this.since === this.hop) { this.since = 0; out.push(this._frame()); }
    }
    return out;
  }
  _frame() {
    const N = this.size, re = this.re, im = this.im;
    let pow = 0;
    for (let i = 0; i < N; i++) {
      const x = this.buf[(this.fill + i) % N];
      pow += x * x;
      re[i] = x * this.win[i]; im[i] = 0;
    }
    fftMag(re, im);
    const fr = { rms: Math.sqrt(pow / N) };
    for (const [name, [lo, hi]] of Object.entries(this.bands)) {
      let flux = 0, e = 0;
      for (let k = lo; k <= hi; k++) {
        const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
        const d = m - this.prev[k];
        if (d > 0) flux += d;
        e += m;
        this.prev[k] = m;
      }
      fr[name] = flux / (hi - lo + 1);
      fr[name + "E"] = e / (hi - lo + 1);
    }
    fr.full = fr.low + fr.mid + fr.high;
    fr.onset = 1.0 * fr.low + 0.8 * fr.mid + 0.6 * fr.high;
    return fr;
  }
}

export class Tempo {
  constructor(fps, opts = {}) {
    this.fps = fps;
    this.len = Math.round(fps * (opts.window ?? 12));
    this.env = new Float32Array(this.len); this.lenv = new Float32Array(this.len); this.menv = new Float32Array(this.len); this.w = 0; this.count = 0;
    this.minBpm = opts.minBpm ?? 70; this.maxBpm = opts.maxBpm ?? 180; this.centre = opts.centre ?? 112;
    this.est = { bpm: 0, period: 0, lastBeat: 0, confidence: 0 };
    this.t = 0;
  }
  push(onset, t, low = onset, mid = 0) {
    this.env[this.w] = onset; this.lenv[this.w] = low; this.menv[this.w] = mid; this.w = (this.w + 1) % this.len; this.count++; this.t = t;
  }
  at(k) { // k frames ago (0 = newest)
    return this.env[(this.w - 1 - k + this.len * 4) % this.len];
  }
  _g(arr, k) { // max over +-1 frame
    const i = (j) => arr[(this.w - 1 - j + this.len * 4) % this.len];
    return Math.max(i(k), k > 0 ? i(k - 1) * 0.7 : 0, i(k + 1) * 0.7);
  }
  estimate() {
    const n = Math.min(this.count, this.len);
    if (n < this.fps * 3) return this.est;
    const fps = this.fps;
    let mean = 0;
    for (let k = 0; k < n; k++) mean += this.at(k);
    mean /= n;
    const lagMin = Math.floor((60 / this.maxBpm) * fps), lagMax = Math.ceil((60 / this.minBpm) * fps);
    const ac = new Float32Array(lagMax + 2);
    let best = -1, bestLag = 0, total = 0;
    let v0 = 0;
    for (let k = 0; k < n; k++) v0 += (this.at(k) - mean) ** 2;
    ac[0] = v0 / n;
    for (let L = lagMin; L <= lagMax + 1; L++) {
      let s = 0;
      for (let k = 0; k + L < n; k++) s += (this.at(k) - mean) * (this.at(k + L) - mean);
      ac[L] = s / (n - L);
    }
    for (let L = lagMin; L <= lagMax; L++) {
      const bpm = (60 * fps) / L;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / this.centre) / 0.55, 2));
      // reward lags whose double is also periodic (metrical support)
      const L2 = Math.min(2 * L, lagMax + 1);
      const score = Math.max(0, ac[L]) * prior + 0.5 * Math.max(0, ac[L2] ?? 0) * prior;
      total += Math.max(0, ac[L]);
      if (score > best) { best = score; bestLag = L; }
    }
    if (!bestLag) return this.est;
    // parabolic refinement
    const y0 = ac[bestLag - 1] ?? ac[bestLag], y1 = ac[bestLag], y2 = ac[bestLag + 1] ?? ac[bestLag];
    const d = (y0 - 2 * y1 + y2) ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
    const lag = bestLag + Math.max(-0.5, Math.min(0.5, d));
    // step 1: fine joint search of period (±3% in 0.1% steps) and phase over
    // 16 beats of the full onset envelope; autocorrelation alone is ~1% coarse
    // at this frame rate, which smears the phase on long combs.
    const ok = (k) => k >= 0 && k + 1 < n;
    const E = (arr, k) => (ok(k) ? this._g(arr, k) : 0);
    let ph0 = 0, best0 = -1, P = lag;
    const beats = Math.max(4, Math.min(16, Math.floor((n - 2) / lag) - 1));
    for (let r = -30; r <= 30; r++) {
      const Pc = lag * (1 + r * 0.001);
      for (let ph = 0; ph < Pc; ph += 1) {
        let s = 0;
        for (let b = 0; b < beats; b++) s += E(this.env, Math.round(ph + b * Pc));
        if (s > best0) { best0 = s; ph0 = ph; P = Pc; }
      }
    }
    const period = P / fps;
    // step 2: syncopated grooves put the strongest onsets off the beat. Search
    // the 16th offset j and bar phase d together for the reading a dancer
    // hears: backbeat (snare-like) on 2 and 4, not on 1 and 3, kick on the one.
    let bestPh = ph0, bestB = 0, bestS = -Infinity;
    const nb = Math.floor((n - 2) / P);
    for (let j = 0; j < 4; j++) {
      const ph = (ph0 + (j * P) / 4) % P;
      const S = [], K = [], A = [];
      for (let b = 0; b < nb; b++) {
        const k = Math.round(ph + b * P);
        S.push(E(this.menv, k)); K.push(E(this.lenv, k)); A.push(E(this.env, k));
      }
      for (let d = 0; d < 4; d++) {
        let s = 0;
        for (let b = 0; b < S.length; b++) {
          const pos = (((d - b) % 4) + 4) % 4; // position in bar of the beat b beats back (0 = one)
          s += (pos % 2 ? 1.0 * S[b] : -0.5 * S[b] + (pos === 0 ? 0.6 * K[b] : 0.2 * K[b])) + 0.25 * A[b];
        }
        if (s > bestS) { bestS = s; bestPh = ph; bestB = d; }
      }
    }
    this.downbeatAgo = (bestPh + bestB * P) / fps;
    this.barBeats = bestB;
    let lastBeat = this.t - bestPh / fps;
    // hysteresis: keep the running phase unless a different one wins 4 times running
    const pe = this.est;
    if (pe.period && this.hyst !== false) {
      const m = Math.round((lastBeat - pe.lastBeat) / pe.period);
      const pred = pe.lastBeat + m * pe.period;
      const d = (lastBeat - pred) / pe.period;
      if (Math.abs(d) < 0.12) { lastBeat = pred + 0.3 * d * pe.period; this._dis = 0; }
      else if ((this._dis = (this._dis || 0) + 1) < 4) lastBeat = pred;
      else this._dis = 0;
    }
    const acConf = Math.max(0, Math.min(1, (ac[bestLag] / (ac[0] + 1e-9)) * 1.25));
    const pe0 = this.est;
    if (pe0.period) {
      let d = (lastBeat - pe0.lastBeat) / pe0.period; d -= Math.round(d);
      this._agree = (this._agree ?? 0.5) * 0.85 + (Math.abs(d) < 0.06 ? 0.15 : 0);
    }
    const conf = Math.max(0, Math.min(1, 0.75 * (this._agree ?? 0) / 0.85 + 0.25 * acConf));
    // smooth period against octave flicker
    const prev = this.est.period;
    const smoothP = prev && Math.abs(period / prev - 1) < 0.06 ? prev * 0.8 + period * 0.2 : period;
    this.est = { bpm: 60 / smoothP, period: smoothP, lastBeat, confidence: conf, lastDownbeat: lastBeat - this.barBeats * smoothP };
    return this.est;
  }
}

export class Meter {
  /** Tracks syncopation (share of onset energy off the beat) and bar phase. */
  constructor() {
    this.sync = 0; this.posMass = new Float32Array(16); this.barAcc = new Float32Array(4);
    this.beatIndex = 0; this.lastBeat = -1;
  }
  observe(onset, t, tempo, lowOnset = 0) {
    if (!tempo.period) return;
    const pos = ((((t - tempo.lastBeat) / tempo.period) % 1) + 1) % 1;
    const slot = Math.round(pos * 4) % 4; // 16th position in the beat
    const beatNo = Math.floor((t - tempo.lastBeat) / tempo.period + 1000.5);
    for (let i = 0; i < 16; i++) this.posMass[i] *= 0.9995;
    this.posMass[slot] += onset;
    for (let i = 0; i < 4; i++) this.barAcc[i] *= 0.9997;
    if (slot === 0) this.barAcc[beatNo % 4] += lowOnset;
    // accents on weak 16th positions relative to the beat itself: 0 = all on
    // the beat, ~1 = off-beats as strong as beats (hats are left out by the caller)
    const on = this.posMass[0] + 1e-9, off = (this.posMass[1] + 1.5 * this.posMass[2] + this.posMass[3]) / 3.5;
    this.sync = Math.min(1, off / on);
  }
  get downbeatOffset() { // which beat (mod 4) carries the strongest low end
    let b = 0;
    for (let i = 1; i < 4; i++) if (this.barAcc[i] > this.barAcc[b]) b = i;
    return b;
  }
}

export class Sections {
  constructor(fps) {
    this.fps = fps; this.short = null; this.long = null; this.last = -1e9; this.novelty = 0; this.peak = 1e-6; this.energy = 0;
  }
  observe(fr, t) {
    const v = [fr.lowE, fr.midE, fr.highE];
    const a = 1 / (this.fps * 1.5), b = 1 / (this.fps * 10);
    this.short = this.short ? this.short.map((x, i) => x + a * (v[i] - x)) : v.slice();
    this.long = this.long ? this.long.map((x, i) => x + b * (v[i] - x)) : v.slice();
    this.novelty = this.short.reduce((s, x, i) => s + Math.abs(x - this.long[i]), 0);
    this.peak = Math.max(this.peak * 0.99995, fr.rms);
    this.energy = this.energy + (1 / this.fps) * 2 * (fr.rms / this.peak - this.energy);
    this.nMean = (this.nMean ?? this.novelty) + (this.novelty - (this.nMean ?? this.novelty)) * b;
    this.nVar = (this.nVar ?? 0.01) + ((this.novelty - this.nMean) ** 2 - (this.nVar ?? 0.01)) * b;
    if (t > 14 && this.novelty > this.nMean + 3 * Math.sqrt(this.nVar) && this.novelty > 0.25 && t - this.last > 8) { this.last = t; return true; }
    return false;
  }
}

/** One object a page or test can feed audio into. */
export class Listener {
  constructor(sampleRate) {
    this.bands = new BandOnsets(sampleRate);
    this.tempo = new Tempo(this.bands.fps);
    this.meter = new Meter();
    this.sections = new Sections(this.bands.fps);
    this.t = 0; this.frames = 0; this.onsets = []; this.events = [];
    this._hist = [];
  }
  feed(samples, t0 = null) {
    const frames = this.bands.process(samples);
    for (const fr of frames) {
      this.t = t0 === null ? this.frames / this.bands.fps : t0;
      this.frames++;
      this.tempo.push(fr.onset, this.t, fr.low, Math.sqrt(fr.mid * fr.high));
      if (this.frames % 32 === 0) this.tempo.estimate();
      this.meter.observe(fr.low + fr.mid, this.t, this.tempo.est, fr.low);
      if (this.sections.observe(fr, this.t)) this.events.push({ type: "section", t: this.t });
      // delayed peak picking (3 frames) for the onset list used by fitness
      this._hist.push([this.t, fr.onset]);
      if (this._hist.length > 7) this._hist.shift();
      if (this._hist.length === 7) {
        const [tc, vc] = this._hist[3];
        const m = this._hist.reduce((s, h) => s + h[1], 0) / 7;
        if (vc > 0.12 && vc >= Math.max(...this._hist.map((h) => h[1])) && vc > 1.5 * m) {
          this.onsets.push({ t: tc, s: vc });
          if (this.onsets.length > 400) this.onsets.shift();
        }
      }
    }
    return frames.length;
  }
  features() {
    const e = this.tempo.est;
    return {
      bpm: e.bpm, period: e.period, lastBeat: e.lastBeat, confidence: e.confidence,
      syncopation: this.meter.sync, lastDownbeat: e.lastDownbeat ?? e.lastBeat,
      energy: Math.max(0, Math.min(1, this.sections.energy)), novelty: this.sections.novelty, t: this.t,
    };
  }
}
