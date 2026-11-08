/* Gobbler demiurge, step 10: sound. Silent until M is pressed: a browser starts audio only after a gesture, and a page should not speak first.
 *  - two beds, one for each scale: a vast one for the bird and the cosmos, a pastoral one for the village. A bed is a 32.8 s clip that loops by crossfading two overlapping copies of
 *    itself (equal power, 4 s), so whatever a codec pads at the ends never shows. The mix between the beds follows the camera's distance to the village (equal power again).
 *  - the heart: a synthesized lub-dub on the Sun's beat tape (data/bird/heart.json, the tape that drives the visual pulse), scheduled against the HeartClock's own phase so the thump lands
 *    with the swell. Loudest at the Heart, quieter out at the ribcage and the Face, gone in the village. A red beat (a defect found) carries a short tick.
 *  - soft failure: a missing file, no WebAudio or a refused context leaves the page silent and says why in a toast (only while the UI is on: stills with ui=none never show one).
 * Files: assets/audio/cosmos.m4a and village.m4a (manifest.json beside them: prompts, seeds, loudness, sha256), data/bird/heart.json. Config: window.GD_CFG.audio (folder), .audioExt (m4a; a published copy may need mp4, the same container) and .heart (tape).
 * Hooks for the tests: window.GDSound and gdApi.sound() (the state, with the gains the mix has chosen).
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var api = window.gdApi; if (!api) return;
  var CFG = Object.assign({ audio: 'assets/audio/', audioExt: 'm4a', heart: 'data/bird/heart.json' }, window.GD_CFG || {});
  var BEDS = ['cosmos', 'village'];
  var XFADE = 4, AHEAD = 0.4, HEART_LEVEL = 0.2;       /* crossfade seconds; how far ahead (s) the thumps are scheduled; the heart bus at full strength (the beds are mastered at -26 LUFS, peaks near -15 dBFS) */
  var S = { on: false, busy: false, ctx: null, master: null, bed: null, heart: null, tick: 0, timer: 0, thumps: 0, v: 0, dV: 99, hg: 0, err: '' };
  var H = null;                                          /* the tape: { T, th: [[seconds in the cycle, strength, red]], cyc, lastF, done } */
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /* ---------- toast (only while the UI is on) ---------- */
  var toastEl = null, toastT = 0;
  function say(text, ms) {
    var root = $('#gv4'); if (!root || root.dataset.ui === 'none') return;
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'gd-toast'; toastEl.setAttribute('role', 'status'); root.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 2600);
  }
  function fail(msg) { S.err = msg; S.busy = false; S.on = false; console.warn('[gobbler] sound: ' + msg); say('Sound is off: ' + msg, 4200); }

  /* ---------- a bed that loops for ever ---------- */
  function curve(up) { var n = 64, c = new Float32Array(n); for (var i = 0; i < n; i++) { var a = i / (n - 1) * Math.PI / 2; c[i] = up ? Math.sin(a) : Math.cos(a); } return c; }
  function loop(ctx, buf, out) {                         /* copies overlap by X seconds and cross at equal power; the next copy is scheduled 8 s before it is needed */
    var D = buf.duration, X = Math.min(XFADE, D / 4), IN = curve(true), OUT = curve(false), L = { at: ctx.currentTime + 0.1, timer: 0 };
    function copy(t) {
      var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = 0; src.connect(g); g.connect(out);
      g.gain.setValueCurveAtTime(IN, t, X); g.gain.setValueCurveAtTime(OUT, t + D - X, X);
      src.start(t); src.stop(t + D + 0.05); src.onended = function () { src.disconnect(); g.disconnect(); };
      return t + D - X;
    }
    function pump() { while (L.at < ctx.currentTime + 8) L.at = copy(L.at); }
    pump(); L.timer = setInterval(pump, 500); return L;
  }

  /* ---------- the heart: lub-dub on the tape ---------- */
  function noiseBuffer(ctx) { var n = Math.floor(ctx.sampleRate * 0.03), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), s = 7; for (var i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } return b; }
  function thump(ctx, dest, t, amp, red, lub, noise) {   /* one swell as sound: a sine that falls from f0 to f1 with its octave above it so small speakers still carry it; a red lub adds a tick */
    var f0 = lub ? 64 : 82, f1 = lub ? 40 : 52, dec = lub ? 0.26 : 0.2, g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
    var tone = dest.tone || dest, tick = dest.tick || dest;          /* the tick bypasses the low-pass that keeps the thump inside the chest */
    o.type = o2.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.12); o2.frequency.setValueAtTime(f0 * 2, t); o2.frequency.exponentialRampToValueAtTime(f1 * 2, t + 0.12);
    g2.gain.value = 0.3; o2.connect(g2); g2.connect(g); o.connect(g); g.connect(tone);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.start(t); o2.start(t); o.stop(t + dec + 0.05); o2.stop(t + dec + 0.05);
    if (red && lub && noise) {
      var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), tg = ctx.createGain(); s.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
      tg.gain.setValueAtTime(0.0001, t); tg.gain.exponentialRampToValueAtTime(amp * 0.5, t + 0.004); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      s.connect(bp); bp.connect(tg); tg.connect(tick); s.start(t); s.stop(t + 0.04);
    }
  }
  function tape(doc) {                                   /* thump times inside one cycle */
    var th = [], at = 0; doc.beats.forEach(function (b) { var d = b[0], red = b[1]; th.push([at + doc.lub * d, red ? 1.2 : 1, red, true], [at + doc.dub * d, red ? 0.75 : 0.62, red, false]); at += d; });
    return { T: doc.cycle, th: th, cyc: 0, lastF: -1, done: -1 };
  }
  function beat() {                                      /* every 60 ms: thumps due in the next AHEAD seconds, placed on the audio clock by their offset from the clock's phase */
    var clock = api.node('HeartClock'); if (!H || !clock || !S.ctx || S.ctx.state !== 'running') return;
    var f = clock.fraction_changed; if (typeof f !== 'number') return;
    if (H.lastF >= 0 && f < H.lastF - 0.5) H.cyc++; H.lastF = f;
    var now = H.cyc * H.T + f * H.T, ctx = S.ctx; if (H.done < 0) H.done = now - 0.001;
    if (S.hg < 0.005) { H.done = now + AHEAD; return; }               /* out of earshot (the village): schedule nothing, keep the tape's place */
    for (var c = H.cyc; c <= H.cyc + 1; c++) H.th.forEach(function (x) {
      var a = c * H.T + x[0]; if (a <= H.done || a > now + AHEAD) return;
      thump(ctx, S.heart, ctx.currentTime + (a - now), x[1], x[2], x[3], S.noise); S.thumps++;
    });
    H.done = now + AHEAD;
  }

  /* ---------- the mix: where the camera is decides what is heard ---------- */
  function mix() {
    var c = (api.cam() || {}).pos || api.stops[0][2], w = api.world(), dV = 99, sun = api.sun;
    if (w) { var s = api.toWorld(w.site); dV = Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]); }
    var v = 1 - smooth(0.01, 0.35, dV);                  /* 1 in the village (the bird's frame: the orbit stop is 0.13 away, the plaza 0.006), 0 from the Earth stop outwards */
    var dS = Math.hypot(c[0] - sun[0], c[1] - sun[1], c[2] - sun[2]);
    var h = Math.max(0, 1 - 0.65 * clamp01(Math.log(dS / 2.4) / Math.log(16 / 2.4))) * (1 - smooth(14, 40, dS)) * (1 - v);      /* 1 at the Heart stop, half at the ribcage, a third at the Face */
    var t = S.ctx.currentTime;
    S.bed.cosmos.g.gain.setTargetAtTime(Math.cos(v * Math.PI / 2), t, 0.4); S.bed.village.g.gain.setTargetAtTime(Math.sin(v * Math.PI / 2), t, 0.4); S.heart.bus.gain.setTargetAtTime(HEART_LEVEL * h, t, 0.4);
    S.v = v; S.dV = dV; S.hg = h;
  }

  /* ---------- on, off ---------- */
  function decode(ctx, ab) { return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); }); }
  function getBytes(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.arrayBuffer(); }); }
  function start() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return fail('this browser has no WebAudio');
    S.busy = true; say('Loading sound\u2026', 6000);
    var ctx = new AC({ latencyHint: 'playback' }), names = BEDS;
    Promise.all(names.map(function (k) { return getBytes(CFG.audio + k + '.' + CFG.audioExt).then(function (ab) { return decode(ctx, ab); }); }).concat([fetch(CFG.heart).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]))
      .then(function (got) {
        S.ctx = ctx; S.master = ctx.createGain(); S.master.gain.value = 0; S.master.connect(ctx.destination); S.bed = {};
        names.forEach(function (k, i) { var g = ctx.createGain(); g.gain.value = 0; g.connect(S.master); S.bed[k] = { g: g, loop: loop(ctx, got[i], g) }; });
        var lp = ctx.createBiquadFilter(), bus = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.5; bus.gain.value = 0; lp.connect(bus); bus.connect(S.master); S.heart = { tone: lp, tick: bus, bus: bus };
        S.noise = noiseBuffer(ctx); H = got[names.length] ? tape(got[names.length]) : null;     /* no tape, no heart: the beds still play */
        S.busy = false; S.on = true; mix(); S.timer = setInterval(mix, 100); S.tick = setInterval(beat, 60);
        S.master.gain.setTargetAtTime(1, ctx.currentTime, 0.8); say('Sound on \u00b7 M to mute'); document.documentElement.dataset.sound = 'on';
      }).catch(function (e) { try { ctx.close(); } catch (x) {} fail((e && e.message) || 'could not load the beds'); });
  }
  function setOn(on) {
    if (!S.ctx) return; S.on = on; var t = S.ctx.currentTime;
    if (on) { S.ctx.resume(); S.master.gain.cancelScheduledValues(t); S.master.gain.setTargetAtTime(1, t, 0.6); say('Sound on \u00b7 M to mute'); }
    else { S.master.gain.cancelScheduledValues(t); S.master.gain.setTargetAtTime(0, t, 0.35); setTimeout(function () { if (!S.on && S.ctx.state === 'running') S.ctx.suspend(); }, 1600); say('Sound off \u00b7 M for sound'); }
    document.documentElement.dataset.sound = on ? 'on' : 'off';
  }
  function press() { if (S.busy) return; if (!S.ctx) start(); else setOn(!S.on); }

  document.addEventListener('keydown', function (ev) {
    if ((ev.key !== 'm' && ev.key !== 'M') || ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))) return;
    press();
  });
  document.addEventListener('visibilitychange', function () { if (!S.ctx || !S.on) return; if (document.hidden) S.ctx.suspend(); else S.ctx.resume(); });
  var hint = $('#gv4-hint'); if (hint) hint.textContent += ' \u00b7 M for sound';

  var GDSound = window.GDSound = {
    toggle: press, thump: thump,
    state: function () {
      return { on: S.on, ctx: S.ctx ? S.ctx.state : 'none', busy: S.busy, error: S.err, beds: S.bed ? Object.keys(S.bed).length : 0, thumps: S.thumps, beats: H ? H.th.length / 2 : 0,
               v: S.v, dV: S.dV, heart: S.hg, gain: S.bed ? { cosmos: S.bed.cosmos.g.gain.value, village: S.bed.village.g.gain.value, heart: S.heart.bus.gain.value } : null };
    }
  };
  api.sound = GDSound.state;
})();
