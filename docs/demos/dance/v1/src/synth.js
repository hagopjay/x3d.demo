// Tiny drum-machine synthesiser for tests (and the lab's demo grooves share the
// pattern definitions). Patterns are 16 steps per bar; swing delays odd 16ths.
export const STYLES = {
  house: { bpm: 124, swing: 0.0, kick: "x...x...x...x...", clap: "....x.......x...", hat: "..x...x...x...x.", bass: "..x..x....x..x.." },
  hiphop: { bpm: 92, swing: 0.18, kick: "x......x..x.....", clap: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", bass: "x......x..x...x." },
  funk: { bpm: 108, swing: 0.08, bassDecay: 14, kick: "x.x....x..x.....", clap: "....x.......x...", hat: "xxxxxxxxxxxxxxxx", bass: "x.x..x.x..x..x.." },
  // known hard case: long bass notes mask the kick on the one (kept as a regression marker)
  funk_masked: { bpm: 108, swing: 0.08, kick: "x..x..x...x..x..", clap: "....x..x....x...", hat: "xxxxxxxxxxxxxxxx", bass: "x..x.xx...x.x..x" },
  straight: { bpm: 120, swing: 0, kick: "x...x...x...x...", clap: "................", hat: "x...x...x...x...", bass: "................" },
};

export function render(style, seconds, sr = 44100, seed = 7) {
  const s = STYLES[style];
  const out = new Float32Array(Math.round(seconds * sr));
  let r = seed;
  const noise = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const step = 60 / s.bpm / 4;
  const steps = Math.floor(seconds / step);
  const add = (t0, fn, dur) => {
    const i0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    for (let i = 0; i < n && i0 + i < out.length; i++) out[i0 + i] += fn(i / sr);
  };
  for (let k = 0; k < steps; k++) {
    const i = k % 16, t = k * step + (i % 2 ? s.swing * step : 0);
    if (s.kick[i] === "x") add(t, (u) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-u * 30)) * u) * Math.exp(-u * 18) * 0.9, 0.25);
    if (s.clap[i] === "x") { let lp = 0; add(t, (u) => { lp += 0.25 * (noise() - lp); return (lp * 1.6 + 0.35 * Math.sin(2 * Math.PI * 190 * u)) * Math.exp(-u * 22) * 0.7; }, 0.2); }
    if (s.hat[i] === "x") { let p = 0; add(t, (u) => { const n = noise(), d = n - p; p = n; return d * Math.exp(-u * 90) * 0.25; }, 0.05); }
    if (s.bass[i] === "x") add(t, (u) => Math.sin(2 * Math.PI * 82 * u) * Math.exp(-u * (s.bassDecay ?? 6)) * 0.35, 0.3);
  }
  return out;
}
