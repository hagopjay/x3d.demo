// HAUL sound, synthesised (no samples): the diesel's firing pulse (rpm / 60 x 3: a four-stroke straight six fires
// three times a revolution), its turbo whistle and exhaust brake; the EV's motor whine and inverter tone; rain,
// tyre scrub, mud and thunder from filtered noise. It starts on the first key press (browsers need a gesture).
export function createAudio() {
  let ctx = null, nodes = null, muted = false;
  function noiseBuffer(c) {
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function start() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    const noise = noiseBuffer(ctx);
    const src = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };
    // diesel: two detuned pulses through a resonant low-pass that opens with load
    const dGain = gain(0, master);
    const dFilter = ctx.createBiquadFilter(); dFilter.type = 'lowpass'; dFilter.Q.value = 6; dFilter.frequency.value = 300; dFilter.connect(dGain);
    const d1 = src('sawtooth', 30), d2 = src('square', 30.4), d3 = src('sawtooth', 15);
    const d1g = gain(0.5, dFilter), d2g = gain(0.3, dFilter), d3g = gain(0.45, dFilter);
    d1.connect(d1g); d2.connect(d2g); d3.connect(d3g);
    const rumble = loop(); const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160; const rg = gain(0, master); rumble.connect(rf); rf.connect(rg);
    const turbo = src('sine', 3000); const tg = gain(0, master); turbo.connect(tg);
    const jake = loop(); const jf = ctx.createBiquadFilter(); jf.type = 'bandpass'; jf.frequency.value = 500; jf.Q.value = 2; const jg = gain(0, master); jake.connect(jf); jf.connect(jg);
    // EV
    const e1 = src('sine', 200), e2 = src('triangle', 1200); const eg1 = gain(0, master), eg2 = gain(0, master); e1.connect(eg1); e2.connect(eg2);
    // environment
    const rainSrc = loop(); const rainF = ctx.createBiquadFilter(); rainF.type = 'highpass'; rainF.frequency.value = 900; const rainG = gain(0, master); rainSrc.connect(rainF); rainF.connect(rainG);
    const tyre = loop(); const tyF = ctx.createBiquadFilter(); tyF.type = 'bandpass'; tyF.frequency.value = 900; tyF.Q.value = 4; const tyG = gain(0, master); tyre.connect(tyF); tyF.connect(tyG);
    const mud = loop(); const mF = ctx.createBiquadFilter(); mF.type = 'lowpass'; mF.frequency.value = 350; const mG = gain(0, master); mud.connect(mF); mF.connect(mG);
    const thunder = loop(); const thF = ctx.createBiquadFilter(); thF.type = 'lowpass'; thF.frequency.value = 120; const thG = gain(0, master); thunder.connect(thF); thF.connect(thG);
    nodes = { master, dGain, dFilter, d1, d2, d3, rg, turbo, tg, jg, jf, e1, e2, eg1, eg2, rainG, tyG, tyF, mG, thG };
  }
  const set = (p, v, t = 0.05) => p.setTargetAtTime(v, ctx.currentTime, t);
  function update(sim, rainNow, flashThunder) {
    if (!ctx || !nodes) return;
    const n = nodes, e = sim.engine, diesel = sim.setup.power === 'diesel';
    const load = Math.max(0, Math.min(1, sim.throttle * 0.8 + Math.abs(e.torque) / 3000 * 0.4));
    if (diesel) {
      const fire = Math.max(8, e.rpm / 60 * 3);
      set(n.d1.frequency, fire); set(n.d2.frequency, fire * 1.012); set(n.d3.frequency, fire / 2);
      set(n.dFilter.frequency, 140 + fire * (2.2 + 5 * load));
      set(n.dGain.gain, muted ? 0 : 0.16 + 0.32 * load);
      set(n.rg.gain, muted ? 0 : 0.08 + 0.2 * load);
      set(n.turbo.frequency, 2200 + 3800 * e.boost * Math.min(1, e.rpm / 1800));
      set(n.tg.gain, muted ? 0 : 0.035 * e.boost * e.boost);
      const jakeOn = sim.setup.exhaustBrake && sim.throttle < 0.02 && e.rpm > 900;
      set(n.jf.frequency, fire * 4); set(n.jg.gain, muted || !jakeOn ? 0 : 0.25);
      set(n.eg1.gain, 0); set(n.eg2.gain, 0);
    } else {
      const w = Math.abs(sim.wheels[2].omega) * 9;
      set(n.e1.frequency, 120 + w * 6); set(n.e2.frequency, 900 + w * 14);
      set(n.eg1.gain, muted ? 0 : 0.03 + 0.1 * load); set(n.eg2.gain, muted ? 0 : 0.015 * load);
      for (const g of [n.dGain, n.rg, n.tg, n.jg]) set(g.gain, 0);
    }
    let scrub = 0, squelch = 0;
    for (const w of sim.wheels) {
      if (!w.contact) continue;
      const s = Math.min(1, Math.abs(w.slip) / 4);
      if (w.surface === 3 || w.surface === 2) squelch = Math.max(squelch, s); else scrub = Math.max(scrub, s * (w.surface === 0 || w.surface === 4 ? 1 : 0.4));
    }
    set(n.tyG.gain, muted ? 0 : 0.18 * scrub);
    set(n.mG.gain, muted ? 0 : 0.3 * squelch);
    set(n.rainG.gain, muted ? 0 : 0.22 * rainNow);
    set(n.thG.gain, muted ? 0 : 0.9 * flashThunder, 0.25);
  }
  return {
    start,
    update,
    toggle() { muted = !muted; return muted; },
    get running() { return !!ctx; },
  };
}
