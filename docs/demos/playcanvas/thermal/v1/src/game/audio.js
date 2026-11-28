// THERMAL sound, synthesised: the variometer (beeps rising in pitch and rate with climb, a low steady tone below
// -1.5 m/s) and wind noise rising with airspeed. Starts on the first key press (browsers need a gesture).
export function createAudio() {
  let ctx = null, osc = null, vg = null, wind = null, wf = null, phase = 0, muted = false;
  function start() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 600; osc.start();
    vg = ctx.createGain(); vg.gain.value = 0; osc.connect(vg); vg.connect(master);
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.start();
    wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.6;
    wind = ctx.createGain(); wind.gain.value = 0; src.connect(wf); wf.connect(wind); wind.connect(master);
  }
  function update(dt, climb, airspeed) {
    if (!ctx || muted) { if (vg) vg.gain.value = 0; if (wind) wind.gain.value = 0; return; }
    const t = ctx.currentTime;
    if (climb > 0.2) {
      osc.frequency.setTargetAtTime(560 + 130 * Math.min(climb, 6), t, 0.05);
      const rate = 1.6 + 1.1 * Math.min(climb, 6);           // beeps per second
      phase = (phase + dt * rate) % 1;
      vg.gain.setTargetAtTime(phase < 0.55 ? 0.22 : 0, t, 0.01);
    } else if (climb < -1.5) {
      osc.frequency.setTargetAtTime(Math.max(180, 420 + 40 * climb), t, 0.1);
      vg.gain.setTargetAtTime(0.08, t, 0.05);
    } else vg.gain.setTargetAtTime(0, t, 0.05);
    wind.gain.setTargetAtTime(Math.min(0.25, (airspeed / 60) ** 2 * 0.2), t, 0.2);
    wf.frequency.setTargetAtTime(300 + airspeed * 12, t, 0.2);
  }
  return { start, update, toggle() { muted = !muted; return !muted; }, get on() { return !!ctx && !muted; } };
}
