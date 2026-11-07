/* The emotional field, lifted from the original page's main script (reference/Manifold-of-Emotion.html,
   sha256 c088f86d…): the four presets, the seven breathing sources, the rotating four-dimensional fold
   (display only) and the ripple impulses. The arithmetic of updateSources, foldCPU and heightAt is the
   original's, statement for statement; only the shared state is gathered into one object so the same
   code runs in the page and under Node (tools/parity.mjs). Nothing here is fitted or tuned.

   The Riemannian structure lives in math-core.js (verbatim): g = lambda^2 (dx^2 + dz^2) on the plane,
   lambda = 1 + sum of seven rotated anisotropic Gaussians. The height drawn by the scene,
   -1.72 ln(lambda) + fold + ripples, is a picture of that metric, not an isometric embedding of it. */
(function (global) {
  'use strict';
  const mix = (a, b, t) => a + (b - a) * t;
  const presets = [
    {name:'Reverie.',tag:'01 / violet · jade · pearl',desc:'A quiet thought becomes a landscape.<br>Touch the surface. Let it ripple.',energy:.7,breath:.65,fold:.65,speed:.65,glow:.65,metal:.70,a:[.11,.59,.68],b:[.48,.24,.72],c:[1.0,.65,.38],phase:0},
    {name:'Euphoria.',tag:'02 / apricot · rose · champagne',desc:'Everything opens toward the light.<br>A field too alive to hold still.',energy:1.0,breath:1.05,fold:.9,speed:.85,glow:.85,metal:.55,a:[.90,.25,.27],b:[.60,.22,.54],c:[1.0,.79,.35],phase:1.8},
    {name:'Catharsis.',tag:'03 / ember · cobalt · molten silver',desc:'Tension gathers, then lets go.<br>Let the disturbance travel through.',energy:1.25,breath:.9,fold:1.35,speed:.8,glow:.8,metal:.85,a:[.055,.35,.82],b:[.60,.10,.30],c:[1.0,.30,.10],phase:3.8},
    {name:'Stillness.',tag:'04 / glacier · jade · moonlight',desc:'The smallest movement is enough.<br>Watch the contours slowly exhale.',energy:.30,breath:.35,fold:.25,speed:.3,glow:.45,metal:.55,a:[.09,.49,.46],b:[.17,.29,.48],c:[.67,.93,.81],phase:5.5}
  ];

  function create(moodIndex = 0) {
    const p0 = presets[moodIndex];
    const F = {
      presets, mood: moodIndex, time: 3.7, phase: p0.phase,
      state: { energy: p0.energy, breath: p0.breath, fold: p0.fold, speed: p0.speed, glow: p0.glow, metal: p0.metal },
      desired: { energy: p0.energy, breath: p0.breath, fold: p0.fold, speed: p0.speed, glow: p0.glow, metal: p0.metal },
      colors: { a: p0.a.slice(), b: p0.b.slice(), c: p0.c.slice() },
      sources: [], impulses: [],
      srcA: new Float32Array(7 * 4), srcB: new Float32Array(7 * 4), pulseData: new Float32Array(8 * 4),
    };
    // Original: updateSources(dt). Smooths state, phase and colours toward the mood, then places the seven sources.
    F.updateSources = function (dt) {
      const state = F.state, desired = F.desired, colors = F.colors, time = F.time, srcA = F.srcA, srcB = F.srcB, pulseData = F.pulseData, impulses = F.impulses;
      const p = presets[F.mood]; F.phase = mix(F.phase, p.phase, 1. - Math.exp(-dt * .8)); const phase = F.phase;
      for (const key of Object.keys(state)) state[key] = mix(state[key], desired[key], 1. - Math.exp(-dt * .9));
      for (const key of ['a', 'b', 'c']) for (let j = 0; j < 3; j++) colors[key][j] = mix(colors[key][j], p[key][j], 1. - Math.exp(-dt * .55));
      const sources = [];
      for (let i = 0; i < 7; i++) {
        let a = i * 2.39996 + phase * .17, rad = i === 0 ? .6 : 2.5 + (i % 3) * 1.6; let q = time * (.19 + i * .013) + i * 1.73;
        let latent = Math.sin(q) * Math.cos(q * .67 + phase);
        let x = Math.cos(a) * rad + Math.sin(time * .12 + i * 1.5) * (.25 + state.energy * .6) + Math.sin(phase + i) * .5;
        let z = Math.sin(a) * rad + Math.cos(time * .10 + i * .9) * (.25 + state.energy * .6);
        let breath = 1 + state.breath * (.27 * Math.sin(q * .8) + .17 * Math.sin(q * 1.31 + i));
        let sx = (1.05 + (i % 3) * .38) * breath, sz = sx * (.72 + .29 * Math.sin(q * .37 + i) ** 2);
        let amp = (2.8 + (i % 4) * 1.1) * (0.6 + state.energy * .7) * (1 + state.breath * .34 * Math.sin(q * .91 + 1.));
        let angle = a + time * .048 + latent * .3;
        let s = { x, z, amp, sx, sz, angle }; sources.push(s);
        srcA.set([x, z, amp, sx], i * 4); srcB.set([Math.cos(angle), Math.sin(angle), sz / sx, 0], i * 4);
      }
      F.sources = sources;
      pulseData.fill(0);
      for (let i = 0; i < 8; i++) { const p = impulses[i]; pulseData.set(p ? [p.x, p.z, p.time, p.amp] : [0, 0, -100, 0], i * 4); }
    };
    // Original: foldCPU(x, z). A rotating R4 coordinate projected into the display height only.
    F.foldCPU = function (x, z) {
      const time = F.time;
      let qx = x * .25, qy = z * .25, qz = Math.sin(x * .19 + time * .13), qw = Math.cos(z * .21 - time * .11), a = time * .12, c = Math.cos(a), s = Math.sin(a);
      let xx = c * qx - s * qw, ww = s * qx + c * qw; c = Math.cos(a * .73); s = Math.sin(a * .73);
      let yy = c * qy - s * qz, zz = s * qy + c * qz; let den = 1.8 - .23 * ww; let vx = xx / den, vy = yy / den, vz = zz / den;
      return F.state.fold * (.65 * Math.sin(vx * 2.6 + vz) * Math.cos(vy * 2.2) + .24 * Math.sin(vz * 3.7 + vy));
    };
    // Original: heightAt(x, z) = -1.72 ln(lambda) + fold + ripples.
    F.lambdaAt = function (x, z) {
      let lam = 1;
      for (let s of F.sources) { let dx = x - s.x, dz = z - s.z, c = Math.cos(s.angle), sn = Math.sin(s.angle), a = c * dx + sn * dz, b = -sn * dx + c * dz; lam += s.amp * Math.exp(-.5 * (a * a / (s.sx * s.sx) + b * b / (s.sz * s.sz))); }
      return lam;
    };
    F.heightAt = function (x, z) {
      const time = F.time;
      let h = -1.72 * Math.log(F.lambdaAt(x, z)) + F.foldCPU(x, z);
      for (let p of F.impulses) { const age = time - p.time; if (age < 0) continue; let r = Math.hypot(x - p.x, z - p.z) - age * 2.15; h += Math.sin(r * 4.2) * Math.exp(-r * r * .75 - age * .53) * p.amp; }
      return h;
    };
    // Settle: the original eases state toward the preset; a settled field is the preset itself.
    F.settle = function () { const p = presets[F.mood]; F.phase = p.phase; for (const k of Object.keys(F.state)) F.state[k] = F.desired[k] = p[k]; for (const k of ['a', 'b', 'c']) F.colors[k] = p[k].slice(); F.updateSources(0); };
    return F;
  }
  global.ManifoldField = Object.freeze({ create, presets });
})(typeof window !== 'undefined' ? window : globalThis);
