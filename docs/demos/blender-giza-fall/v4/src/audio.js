// view: synthesised sound, no samples. Every producer goes through play(), which checks the one sound switch
// (Loom PHYSICS-PLAYBOOK pattern 31). Impacts follow v1's grouping: pelvis and torso thud, limbs smack, head knocks.
export class Audio {
  constructor() { this.on = false; this.ctx = null; this.gates = {}; this.master = null; }
  enable(on) {
    this.on = on;
    if (on && !this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination); } catch { this.on = false; } }
    if (this.ctx) this.ctx.state === 'suspended' && on ? this.ctx.resume() : null;
  }
  ok(key, ms) { if (!this.on || !this.ctx) return false; const t = performance.now(); if (this.gates[key] && t - this.gates[key] < ms) return false; this.gates[key] = t; return true; }
  osc(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol, freq, type = 'lowpass', delay = 0, q = 0.8) {
    const c = this.ctx, n = Math.max(1, Math.floor(c.sampleRate * dur)), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.6;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master); s.start(c.currentTime + delay);
  }
  impact(part, J, rate = 1) {
    if (!this.ok('imp' + part, 45)) return; const v = Math.min(0.5, 0.06 + J / 900);
    if (part === 'head') { this.osc('triangle', 520 * rate, 260 * rate, 0.09, v); this.noise(0.04, v * 0.6, 2400); }
    else if (part === 'pelvis' || part === 'torso') { this.osc('sine', 110 * rate, 45 * rate, 0.22, v * 1.3); this.noise(0.12, v * 0.8, 500); }
    else { this.noise(0.07, v, 1800 * rate, 'bandpass', 0, 1.2); this.osc('square', 240 * rate, 120 * rate, 0.05, v * 0.25); }
  }
  pop() { if (this.ok('pop', 30)) { this.noise(0.05, 0.25, 3200, 'highpass'); this.osc('square', 900, 300, 0.04, 0.05); } }
  splat() { if (this.ok('splat', 25)) { this.noise(0.12, 0.22, 900, 'bandpass', 0, 2); this.osc('sine', 300, 90, 0.08, 0.08); } }
  shove() { if (this.ok('shove', 120)) { this.noise(0.2, 0.4, 700); this.osc('sine', 160, 60, 0.25, 0.3); } }
  whistle(T) { if (!this.ok('whistle', 200)) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime, d = Math.min(T, 5.5);
    o.type = 'sine'; o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(500, t + d); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g).connect(this.master); o.start(t); o.stop(t + d + 0.05); }
  boom(big = 1) { if (!this.ok('boom', 60)) return; this.noise(1.4 * big, 0.9, 380); this.osc('sine', 90, 28, 1.1 * big, 0.7); this.noise(0.25, 0.5, 3000, 'highpass'); }
  thunder() { if (!this.ok('thunder', 300)) return; this.noise(0.12, 0.8, 6000, 'highpass'); this.noise(2.6, 0.9, 260, 'lowpass', 0.05); this.noise(1.4, 0.5, 120, 'lowpass', 0.5); }
  zap() { if (this.ok('zap', 80)) { this.osc('sawtooth', 1800, 200, 0.12, 0.08); this.noise(0.06, 0.15, 5000, 'highpass'); } }
  chord(kind) {   // a short sting when an omen arrives
    if (!this.ok('chord', 400)) return;
    const sets = { electro: [220, 311, 440], super: [196, 247, 294, 392], meta: [233, 277, 349, 466], military: [98, 147, 196], paint: [392, 494, 587, 784] };
    (sets[kind] || sets.super).forEach((f, i) => { this.osc(kind === 'military' ? 'square' : 'sine', f, f * (kind === 'meta' ? 0.97 : 1), 1.6, 0.07, i * 0.04); if (kind === 'super') this.osc('sine', f * 2.005, f * 2.005, 1.8, 0.03, i * 0.04); });
  }
  portal() { if (this.ok('portal', 150)) { this.osc('sine', 180, 720, 0.35, 0.15); this.osc('sine', 360, 1440, 0.35, 0.06); } }
  fanfare() { if (this.ok('fan', 800)) [523, 659, 784, 1046].forEach((f, i) => this.osc('triangle', f, f, 0.25, 0.12, i * 0.13)); }
  wind(on) { /* the khamsin is shown, not heard: a continuous source would outlive the sound switch on some hosts */ }
}
