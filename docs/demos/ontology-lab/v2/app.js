/* Semantic Twin Lab. The world is data/scenes/<scene>.xml rendered by X_ITE 16.5.1. The twin (beads, threads) and the
   ontology sky (class stars, subClassOf arcs, type plumb lines) are placed from data/twin-layout.json and checked against
   the live N3.js store of the Turtle. Station jobs run live (Comunica, shacl-engine, N3 Reasoner) in engine-worker.js and
   are compared with the Python oracle answers carried in data/stations.json. Every number on screen is computed here, or
   read from a receipt and shown with its source and grade. */
(async function () {
  'use strict';
  const R = window.__R = { marks: {}, errors: [], violations: [], runs: {}, done: false };
  const T0 = performance.now(), now = () => performance.now();
  const mark = k => { R.marks[k] = +(now() - T0).toFixed(1); };
  document.addEventListener('securitypolicyviolation', e => R.violations.push(e.violatedDirective + ' ' + String(e.blockedURI).slice(0, 90)));
  window.addEventListener('error', e => R.errors.push('window: ' + String(e.message).slice(0, 300)));
  window.addEventListener('unhandledrejection', e => R.errors.push('promise: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 300)));
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = window.E_lab_stack, DF = L.DataFactory, nn = DF.namedNode;
  const RM = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const QS = new URLSearchParams(location.search);
  const live = msg => { const el = $('#live'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); };

  // ------------------------------------------------------------------ vocabulary
  const X = 'https://www.web3d.org/specifications/X3dOntology4.1#';
  const B = 'https://semantic-twin-lab.example/TheCabinet.ttl#';
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', RDFS = 'http://www.w3.org/2000/01/rdf-schema#', OWL = 'http://www.w3.org/2002/07/owl#';
  const T_TYPE = nn(RDF + 'type'), T_SC = nn(RDFS + 'subClassOf'), T_FIRST = nn(RDF + 'first'), T_REST = nn(RDF + 'rest');
  const short = iri => iri.startsWith(B) ? ':' + iri.slice(B.length) : iri.startsWith(X) ? 'x3do:' + iri.slice(X.length) : iri.startsWith(RDF) ? 'rdf:' + iri.slice(RDF.length) : iri.startsWith(RDFS) ? 'rdfs:' + iri.slice(RDFS.length) : iri.startsWith(OWL) ? 'owl:' + iri.slice(OWL.length) : iri;
  const expand = v => typeof v !== 'string' ? null : v.startsWith(':') ? B + v.slice(1) : v.startsWith('x3do:') ? X + v.slice(5) : v.startsWith('http') ? v : null;

  // ------------------------------------------------------------------ small math (X3D frames, camera)
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => a + (b - a) * t, lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const f3 = v => v.map(x => +x.toFixed(4)).join(' ');
  const mR = r => { const [x, y, z] = norm(r.slice(0, 3)), a = r[3], c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1]; };
  const mp = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const C = { teal: '#3de6d1', gold: '#ffc857', hit: '#e8fbff', red: '#ff5a5f', amber: '#ffb347', green: '#5fd18a', aur1: '#49f2b0', aur2: '#8f86ff', violet: '#9d8cff', lilac: '#c8b8ff', slate: '#8ea3bd', route: '#ffd9a8' };
  const rgbaA = (h, a) => [...hex(h), a];
  const curve = (a, b, lift, n = 10) => { const m = add(lerp3(a, b, 0.5), [0, lift, 0]); const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push(add(add(mul(a, (1 - t) * (1 - t)), mul(m, 2 * t * (1 - t))), mul(b, t * t))); } return out; };

  // ------------------------------------------------------------------ fetch + X_ITE dress (DESIGN §5)
  const txt = p => fetch(p, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return r.text(); });
  const json = p => txt(p).then(JSON.parse);
  const el = $('#x3d');
  let cssText = '';
  const DRESS = ':host{display:block;overflow:hidden}.x_ite-private-browser{height:100%;outline:none;overflow:hidden;position:relative;background:transparent}.x_ite-private-surface{height:100%}.x_ite-private-canvas{height:100%;width:100%}.x_ite-private-splash-screen{display:none}';
  const dress = () => { const root = el.shadowRoot; if (!root) return; const b = root.querySelector('.x_ite-private-browser');
    if (!root.querySelector('style[data-stl]')) { const st = document.createElement('style'); st.setAttribute('data-stl', '1'); st.textContent = cssText + '\n' + DRESS; root.appendChild(st); }
    if (b && b.style.display === 'none') b.style.display = ''; };
  { let tries = 0; const iv = setInterval(() => { dress(); if (++tries >= 20) clearInterval(iv); }, 250); }

  // Worker execution is bounded by a watchdog on the main thread. A timed-out
  // synchronous reasoner is terminated; the next request starts a fresh worker.
  const engineClient = new window.TwinWorkerClient({ url: 'engine-worker.js', timeoutMs: 20000 });

  try {
    mark('script_start');
    const browser = el.browser; R.xiteVersion = browser.version;
    const engInit = engineClient.init();
    const [ST, LAY, cabTtl, sliceTtl, css, FM, PAR, PINS, MAN, VAL, RENDER, MCP, LSTACK, WIRE] = await Promise.all([
      json('data/stations.json'), json('data/twin-layout.json'), txt('data/ttl/cabinet.ttl.txt'), txt('data/ttl/slice.ttl.txt'), txt('vendor/x_ite/x_ite.css'),
      json('data/receipts/fault-matrix.json'), json('data/receipts/parity.json'), json('data/receipts/pins.json'), json('data/manifest.json'),
      json('data/receipts/validation.json'), json('data/receipts/render.json'), json('data/receipts/mcp-calls.json'), json('vendor/lab-stack.json').catch(() => null),
      json('data/receipts/wire-tool.json')]);
    // Apply documented editorial corrections in memory. Original station bytes
    // and all historical receipts remain intact and hash-verifiable.
    let correctionIds = [];
    try {
      const edits = await json('data/study-corrections.json');
      const sourceHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await txt('data/stations.json')));
      const sourceHex = [...new Uint8Array(sourceHash)].map(x => x.toString(16).padStart(2, '0')).join('');
      if (sourceHex !== edits.source_stations_sha256) throw new Error('Station corrections target a different source hash');
      for (const edit of edits.corrections) { const station = ST.stations.find(s => s.id === edit.station); if (!station || station[edit.field] !== edit.previous) throw new Error('Correction source mismatch: ' + edit.id); }
      for (const edit of edits.corrections) {
        const station = ST.stations.find(s => s.id === edit.station);
        station[edit.field] = edit.replacement;
        (station.editorialCorrections || (station.editorialCorrections = [])).push(edit.id);
        correctionIds.push(edit.id);
      }
      R.editorialCorrections = correctionIds;
    } catch (e) { R.errors.push('Editorial corrections: ' + e.message); }
    mark('fetched');
    cssText = css.replace(/@font-face\s*\{[^}]*\}/g, ''); dress();
    let world = 'cabinet';
    const loaded = browser.loadURL(new X3D.MFString('data/scenes/cabinet.xml'));

    // ---------------------------------------------------------------- the live twin (N3.js) and the counts it must agree with
    const tp = now();
    const sceneQuads = new L.Parser().parse(cabTtl), sliceQuads = new L.Parser().parse(sliceTtl);
    const store = new L.Store(sceneQuads), onto = new L.Store(sliceQuads);
    R.parse_ms = +(now() - tp).toFixed(1);
    const individuals = new Set(store.getSubjects(T_TYPE, nn(OWL + 'NamedIndividual'), null).map(t => t.value));
    const statedClasses = new Set(); for (const q of store.match(null, T_TYPE, null)) if (q.object.value.startsWith(X) && individuals.has(q.subject.value)) statedClasses.add(q.object.value);
    const ancestors = new Set(statedClasses); { const qq = [...statedClasses]; while (qq.length) { const c = qq.pop(); for (const p of onto.getObjects(nn(c), T_SC, null)) if (p.value.startsWith(X) && !ancestors.has(p.value)) { ancestors.add(p.value); qq.push(p.value); } } }
    const layoutNodes = new Map(Object.entries(LAY.nodes)), layoutClasses = new Map(Object.entries(LAY.classes));
    const missingNodes = [...individuals].filter(i => !layoutNodes.has(i)), extraNodes = [...layoutNodes.keys()].filter(i => !individuals.has(i));
    const missingClasses = [...ancestors].filter(c => !layoutClasses.has(c));
    R.counts = { triples: store.size, individuals: individuals.size, layoutNodes: layoutNodes.size, statedClasses: statedClasses.size, statedPlusAncestors: ancestors.size,
      layoutClasses: layoutClasses.size, missingNodes: missingNodes.length, extraNodes: extraNodes.length, missingClasses: missingClasses.length,
      layoutCounts: LAY.counts, agree: individuals.size === LAY.counts.nodes && missingNodes.length === 0 && extraNodes.length === 0 && missingClasses.length === 0 && layoutClasses.size === LAY.counts.classes };

    await loaded; mark('scene_loaded'); dress();
    if (RM) { try { const c = browser.currentScene.getNamedNode('Clock'); if (c) { c.enabled = false; R.clockStopped = true; } } catch (e) {} }
    let scene = browser.currentScene;

    // ---------------------------------------------------------------- model from the layout
    const nodes = new Map(); for (const [iri, n] of layoutNodes) nodes.set(iri, Object.assign({}, n));
    const bayOf = n => { let p = n, g = 0; while (p && g++ < 20) { if (/^Bay\d$/.test(p.local)) return p; p = nodes.get(p.parent); } return null; };
    for (const n of nodes.values()) n.bay = bayOf(n);
    const bays = [...nodes.values()].filter(n => /^Bay\d$/.test(n.local)).sort((a, b) => a.local.localeCompare(b.local));
    for (const b of bays) { const vp = [...nodes.values()].find(k => k.element === 'Viewpoint' && k.parent === b.iri); b.title = vp && vp.description ? vp.description.split(':')[0].replace(/^\d+\s*/, '') : b.local; b.num = b.local.slice(3); }
    const classes = new Map(); for (const [iri, k] of layoutClasses) classes.set(iri, Object.assign({ abstract: k.height > 0 }, k));
    const typeOf = new Map(); for (const q of store.match(null, T_TYPE, null)) if (q.object.value.startsWith(X) && nodes.has(q.subject.value)) typeOf.set(q.subject.value, q.object.value);

    // ---------------------------------------------------------------- textures (2D canvas → PixelTexture through SAI; no network, CSP-safe)
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const pix = (w, h, draw) => { cv.width = w; cv.height = h; cx.clearRect(0, 0, w, h); draw(cx, w, h); const d = cx.getImageData(0, 0, w, h).data; const px = new Array(w * h); let k = 0;
      for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; px[k++] = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]); } return { w, h, px }; };
    const rgba = (h, a) => { const c = hex(h).map(v => Math.round(v * 255)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
    const glow = (col, core = 0.1, strength = 1) => (g, w) => { const r = w / 2; const gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, `rgba(255,255,255,${strength})`); gr.addColorStop(core, rgba(col, 0.95 * strength)); gr.addColorStop(core * 2.2, rgba(col, 0.42 * strength)); gr.addColorStop(0.55, rgba(col, 0.12 * strength)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, w); };
    const star = col => (g, w, h) => { glow(col, 0.07, 0.95)(g, w, h); const r = w / 2; g.globalCompositeOperation = 'lighter';
      for (const [ax, ay] of [[1, 0], [0, 1]]) { const gr = g.createLinearGradient(r - ax * r, r - ay * r, r + ax * r, r + ay * r); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.5, rgba(col, 0.6)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr;
        if (ax) g.fillRect(0, r - 0.6, w, 1.2); else g.fillRect(r - 0.6, 0, 1.2, h); } g.globalCompositeOperation = 'source-over'; };
    const beadT = col => (g, w) => { glow(col, 0.1, 0.7)(g, w); const r = w / 2; g.strokeStyle = rgba(col, 0.95); g.lineWidth = w * 0.055; g.beginPath(); g.arc(r, r, r * 0.3, 0, 7); g.stroke(); g.fillStyle = 'rgba(236,244,252,.95)'; g.beginPath(); g.arc(r, r, r * 0.1, 0, 7); g.fill(); };
    const dashT = col => (g, w) => { const r = w / 2; glow(col, 0.06, 0.25)(g, w); g.strokeStyle = rgba(col, 0.95); g.lineWidth = w * 0.06; g.setLineDash([w * 0.09, w * 0.07]); g.beginPath(); g.arc(r, r, r * 0.3, 0, 7); g.stroke(); g.setLineDash([]); };
    const dotT = col => (g, w) => { const r = w / 2; const gr = g.createRadialGradient(r, r, 0, r, r, r * 0.5); gr.addColorStop(0, rgba(col, 0.75)); gr.addColorStop(0.5, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, w); };
    const rosetteT = col => (g, w) => { const r = w / 2; glow(col, 0.05, 0.35)(g, w); g.strokeStyle = rgba(col, 0.9); g.lineWidth = w * 0.04; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(r + Math.cos(a) * r * 0.16, r + Math.sin(a) * r * 0.16, r * 0.16, 0, 7); g.stroke(); } };
    const markT = (col, kind) => (g, w) => { glow(col, 0.12, 1)(g, w); const r = w / 2; g.strokeStyle = 'rgba(10,6,12,.92)'; g.lineWidth = w * 0.07; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      if (kind === 'x') { const k = r * 0.17; g.moveTo(r - k, r - k); g.lineTo(r + k, r + k); g.moveTo(r + k, r - k); g.lineTo(r - k, r + k); }
      else if (kind === 'ok') { const k = r * 0.18; g.moveTo(r - k, r); g.lineTo(r - k * 0.2, r + k * 0.8); g.lineTo(r + k, r - k * 0.7); }
      else { const k = r * 0.2; g.moveTo(r, r - k); g.lineTo(r + k, r + k * 0.8); g.lineTo(r - k, r + k * 0.8); g.closePath(); } g.stroke(); };
    const curtain = (cLow, cHigh, amp) => (g, w, h) => { const img = g.createImageData(w, h); const lo = hex(cLow), hi = hex(cHigh);
      for (let x = 0; x < w; x++) { const u = x / w * Math.PI * 2; const ray = 0.45 + 0.25 * Math.sin(u * 3 + 1) + 0.18 * Math.sin(u * 7 + 2.1) + 0.12 * Math.sin(u * 13 + 0.4) + 0.08 * Math.sin(u * 23 + 5);
        for (let y = 0; y < h; y++) { const v = 1 - y / (h - 1); const bottom = Math.min(1, v / 0.14), top = Math.pow(1 - v, 1.6); const a = Math.max(0, bottom * top * ray * amp);
          const t = Math.min(1, v * 1.25), i = (y * w + x) * 4; img.data[i] = 255 * lerp(lo[0], hi[0], t); img.data[i + 1] = 255 * lerp(lo[1], hi[1], t); img.data[i + 2] = 255 * lerp(lo[2], hi[2], t); img.data[i + 3] = 255 * Math.min(1, a); } }
      g.putImageData(img, 0, 0); };
    const shaftT = (col, up) => (g, w, h) => { const img = g.createImageData(w, h); const c = hex(col);
      for (let y = 0; y < h; y++) { const v = 1 - y / (h - 1); for (let x = 0; x < w; x++) { const u = (x + 0.5) / w * 2 - 1; const across = Math.exp(-u * u * 5.5) * 0.75 + Math.exp(-u * u * 60) * 0.5;
        const along = up ? Math.pow(1 - v, 1.3) * Math.min(1, v * 8) : Math.pow(v, 0.9) * Math.min(1, (1 - v) * 10); const a = Math.min(1, across * along); const i = (y * w + x) * 4; const wht = Math.exp(-u * u * 60) * 0.6;
        img.data[i] = 255 * lerp(c[0], 1, wht); img.data[i + 1] = 255 * lerp(c[1], 1, wht); img.data[i + 2] = 255 * lerp(c[2], 1, wht); img.data[i + 3] = 255 * a; } } g.putImageData(img, 0, 0); };
    const haloT = col => (g, w) => { const r = w / 2; const gr = g.createRadialGradient(r, r, r * 0.35, r, r, r); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.55, rgba(col, 0.85)); gr.addColorStop(0.62, rgba(col, 0.4)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, w); };
    const floorT = (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(61,230,209,0.18)'); gr.addColorStop(0.45, 'rgba(73,242,176,0.07)'); gr.addColorStop(0.8, 'rgba(125,107,255,0.03)'); gr.addColorStop(1, 'rgba(125,107,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    const ttx = now();
    const TEX = {
      def: pix(32, 32, beadT(C.teal)), use: pix(32, 32, dashT(C.lilac)), pos: pix(32, 32, dotT(C.teal)), doc: pix(32, 32, rosetteT(C.slate)),
      hit: pix(32, 32, glow(C.hit, 0.16, 1)), gold: pix(32, 32, glow(C.gold, 0.14, 1)), sel: pix(32, 32, beadT(C.hit)),
      red: pix(48, 48, markT(C.red, 'x')), amber: pix(48, 48, markT(C.amber, 'w')), ok: pix(48, 48, markT(C.green, 'ok')),
      clsLo: pix(48, 48, star(C.aur1)), clsUp: pix(48, 48, star(C.violet)), clsGold: pix(48, 48, star(C.gold)), clsHot: pix(48, 48, star(C.hit)),
      curLo: pix(96, 40, curtain('#2fe9a6', '#7d6bff', 0.9)), curUp: pix(96, 40, curtain('#5f63ff', '#b07cff', 0.5)), curGold: pix(96, 40, curtain('#ffb347', '#ff7aa8', 0.75)),
      shaft: pix(16, 64, shaftT(C.hit, false)), beacon: pix(16, 64, shaftT(C.red, true)), beaconA: pix(16, 64, shaftT(C.amber, true)),
      floor: pix(64, 32, floorT), haloHit: pix(48, 48, haloT(C.hit)), haloRed: pix(48, 48, haloT(C.red)), haloAmber: pix(48, 48, haloT(C.amber)), haloGreen: pix(48, 48, haloT(C.green)),
      mote: pix(16, 16, glow(C.hit, 0.25, 1)),
    };
    R.tex_ms = +(now() - ttx).toFixed(1);

    // ---------------------------------------------------------------- X3D overlay: built ONCE (createX3DFromString); everything dynamic is a field write
    const sprite = (def, appDef, p, s) => `<Transform DEF='${def}' translation='${f3(p)}' scale='${s} ${s} ${s}'><Billboard axisOfRotation='0 0 0'><Shape DEF='${def}S'><Appearance USE='${appDef}'/><IndexedFaceSet USE='Q'/></Shape></Billboard></Transform>`;
    const lineSet = (def, segs) => { const P = [], Cc = [], I = []; let k = 0;
      for (const s of segs) { const pts = s.pts || [s[0], s[1]], cols = s.cols || [s[2], s[3]]; pts.forEach((p, i) => { P.push(f3(p)); Cc.push(cols[i].map(x => +x.toFixed(3)).join(' ')); I.push(k++); }); I.push(-1); }
      if (!P.length) { P.push('0 0 0', '0 0 0'); Cc.push('0 0 0 0', '0 0 0 0'); I.push(0, 1, -1); }
      return `<Shape DEF='${def}'><IndexedLineSet colorPerVertex='true' coordIndex='${I.join(' ')}'><Coordinate DEF='${def}P' point='${P.join(' ')}'/><ColorRGBA DEF='${def}C' color='${Cc.join(' ')}'/></IndexedLineSet></Shape>`; };
    // fixed-capacity dynamic line layers: coordIndex never changes; only Coordinate.point and ColorRGBA.color are written
    const DYN = { GoldL: 160, PluckL: 140, HotL: 60 };
    const dynSet = (def, cap) => { const I = []; for (let i = 0; i < cap; i++) I.push(2 * i, 2 * i + 1, -1);
      return `<Shape DEF='${def}'><IndexedLineSet colorPerVertex='true' coordIndex='${I.join(' ')}'><Coordinate DEF='${def}P' point='${Array(cap * 2).fill('0 -50 0').join(' ')}'/><ColorRGBA DEF='${def}C' color='${Array(cap * 2).fill('0 0 0 0').join(' ')}'/></IndexedLineSet></Shape>`; };
    const cam0 = LAY.frame.twin_camera; const CAM = { eye: cam0.position, rot: cam0.orientation, fov: cam0.fieldOfView };
    const DOME = LAY.frame.dome, AC = LAY.frame.arc_centre_xz;
    const ribbon = (def, appDef, r, yb, yt, a0, a1, n, wob) => { const P = [], T = [], I = [];
      for (let i = 0; i <= n; i++) { const t = i / n, a = lerp(a0, a1, t), rr = r + wob * Math.sin(a * 5 + 1.3) + wob * 0.6 * Math.sin(a * 11), dy = 0.15 * Math.sin(a * 4 + 0.7);
        const x = AC[0] + Math.sin(a) * rr, z = AC[1] - Math.cos(a) * rr, taper = Math.pow(Math.sin(Math.PI * t), 0.6); P.push(f3([x, yb + dy, z]), f3([x, yb + dy + (yt - yb) * taper + dy * 0.6, z])); T.push(`${(t * 5).toFixed(4)} 0`, `${(t * 5).toFixed(4)} 1`); }
      for (let i = 0; i < n; i++) I.push(`${2 * i} ${2 * i + 2} ${2 * i + 3} ${2 * i + 1} -1`);
      return `<Shape DEF='${def}'><Appearance USE='${appDef}'/><IndexedFaceSet solid='false' coordIndex='${I.join(' ')}' texCoordIndex='${I.join(' ')}'><Coordinate point='${P.join(' ')}'/><TextureCoordinate point='${T.join(' ')}'/></IndexedFaceSet></Shape>`; };
    const beadDef = n => 'b_' + n.local.replace(/[^A-Za-z0-9_]/g, '_');
    const clsDef = k => 'c_' + k.name;
    const beadApp = n => n.kind === 'document' ? 'A_doc' : n.kind === 'use' ? 'A_use' : n.kind === 'positional' ? 'A_pos' : 'A_def';
    const beadSize = n => n.kind === 'document' ? 0.34 : n.kind === 'positional' ? 0.17 : n.kind === 'use' ? 0.26 : 0.30;
    const tb = now();
    const APPS = { A_def: 'def', A_use: 'use', A_pos: 'pos', A_doc: 'doc', A_hit: 'hit', A_gold: 'gold', A_sel: 'sel', A_red: 'red', A_amber: 'amber', A_ok: 'ok', A_clsLo: 'clsLo', A_clsUp: 'clsUp', A_clsGold: 'clsGold', A_clsHot: 'clsHot',
      A_shaft: 'shaft', A_beacon: 'beacon', A_beaconA: 'beaconA', A_haloHit: 'haloHit', A_haloRed: 'haloRed', A_haloAmber: 'haloAmber', A_haloGreen: 'haloGreen', A_floor: 'floor', A_mote: 'mote' };
    const CURS = [['A_curLo', 'curLo'], ['A_curLo2', 'curLo'], ['A_curUp', 'curUp'], ['A_curGold', 'curGold']];
    let X3 = `<Viewpoint DEF='TwinCam' description='Twin camera (layout twin_camera)' position='${f3(CAM.eye)}' orientation='${f3(CAM.rot)}' fieldOfView='${CAM.fov}' centerOfRotation='0 2.6 -1.4'/>
<ProximitySensor DEF='Eye' size='1000 1000 1000'/>
<Shape><Appearance><Material transparency='1'/></Appearance><IndexedFaceSet DEF='Q' solid='false' coordIndex='0 1 2 3 -1' texCoordIndex='0 1 2 3 -1'><Coordinate point='-0.5 -0.5 0 0.5 -0.5 0 0.5 0.5 0 -0.5 0.5 0'/><TextureCoordinate point='0 0 1 0 1 1 0 1'/></IndexedFaceSet></Shape>
<Shape><Appearance><Material transparency='1'/></Appearance><IndexedFaceSet DEF='QD' solid='false' coordIndex='0 1 2 3 -1' texCoordIndex='0 1 2 3 -1'><Coordinate point='-0.5 -1 0 0.5 -1 0 0.5 0 0 -0.5 0 0'/><TextureCoordinate point='0 0 1 0 1 1 0 1'/></IndexedFaceSet></Shape>`;
    let appsX = ''; for (const d of Object.keys(APPS)) appsX += `<Shape><Appearance DEF='${d}'><PixelTexture DEF='${d}PX' repeatS='false' repeatT='false'/></Appearance></Shape>`;
    for (const [d] of CURS) appsX += `<Shape><Appearance DEF='${d}'><PixelTexture DEF='${d}PX' repeatS='true' repeatT='false'/><TextureTransform DEF='${d}TT'/></Appearance></Shape>`;
    X3 += `<Switch whichChoice='-1'>${appsX}</Switch>`;
    { let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const P = [], Cc = [];
      for (let i = 0; i < 340; i++) { const az = (rnd() * 2 - 1) * 1.9, elv = 0.16 + Math.pow(rnd(), 0.8) * 0.95, r = 46; P.push(f3([Math.sin(az) * Math.cos(elv) * r, Math.sin(elv) * r, 3 - Math.cos(az) * Math.cos(elv) * r]));
        const w = rnd(); Cc.push(`${(0.75 + 0.25 * w).toFixed(2)} ${(0.82 + 0.18 * w).toFixed(2)} 1 ${(0.18 + 0.6 * Math.pow(rnd(), 2)).toFixed(2)}`); }
      X3 += `<Shape DEF='Stars'><PointSet><Coordinate point='${P.join(' ')}'/><ColorRGBA color='${Cc.join(' ')}'/></PointSet></Shape>`; }
    X3 += `<Transform DEF='FloorGlow' translation='0 0.015 -1.2' rotation='1 0 0 -1.5708' scale='22 12 1'><Shape><Appearance USE='A_floor'/><IndexedFaceSet USE='Q'/></Shape></Transform>`;
    const AZ = DOME.az_max * Math.PI / 180;
    X3 += `<Group DEF='Aurora'>${ribbon('CurLo', 'A_curLo', DOME.r_low + 0.25, DOME.y_low - 0.35, DOME.y_low + 1.0, -AZ - 0.08, AZ + 0.08, 130, 0.18)}${ribbon('CurLo2', 'A_curLo2', DOME.r_low + 0.55, DOME.y_low - 0.15, DOME.y_low + 0.75, -AZ, AZ, 100, 0.25)}${ribbon('CurUp', 'A_curUp', DOME.r_low - DOME.dr * 1.6, DOME.y_low + 0.45, DOME.y_low + 2.6, -AZ * 0.9, AZ * 0.9, 110, 0.22)}</Group>`;
    X3 += `<Group DEF='Classes'>` + [...classes.values()].map(k => sprite(clsDef(k), k.abstract ? 'A_clsUp' : 'A_clsLo', k.pos, k.abstract ? 0.44 : 0.5)).join('') + `</Group>`;
    // explicit layers from the layout's edge list
    const scSegs = [], typeSegs = [], edgeSegs = [], sameSegs = [], sameSegsHi = [], routeArcs = [];
    for (const e of LAY.edges) {
      if (e.kind === 'subClassOf') { const a = classes.get(e.s), b = classes.get(e.o); if (a && b) scSegs.push({ pts: curve(a.pos, b.pos, 0.22, 10), cols: Array.from({ length: 11 }, (_, i) => rgbaA(C.violet, 0.2 + 0.18 * i / 10)) }); }
      else if (e.kind === 'type') { const n = nodes.get(e.s), k = classes.get(e.o); if (n && k) typeSegs.push([n.twin, k.pos, rgbaA(C.teal, 0.14), rgbaA(C.aur1, 0.05)]); }
      else if (e.kind === 'field' && e.draw) { const a = nodes.get(e.s), b = nodes.get(e.o); if (a && b) { const al = (a.kind === 'positional' || b.kind === 'positional') ? 0.32 : 0.55; edgeSegs.push([a.twin, b.twin, rgbaA(C.teal, al), rgbaA(C.teal, al * 0.75)]); } }
      else if (e.kind === 'sameAs') { const a = nodes.get(e.s), b = nodes.get(e.o); if (a && b) { const pts = curve(a.twin, b.twin, 0.25 + 0.12 * len(sub(a.twin, b.twin)), 18);
        for (let i = 0; i < pts.length - 1; i += 2) { sameSegs.push([pts[i], pts[i + 1], rgbaA(C.lilac, 0.25), rgbaA(C.lilac, 0.25)]); sameSegsHi.push([pts[i], pts[i + 1], rgbaA(C.teal, 1), rgbaA(C.teal, 1)]); } } }
      else if (e.kind === 'route_arc') { const a = nodes.get(e.s), b = nodes.get(e.o); if (a && b) routeArcs.push({ pts: curve(a.twin, b.twin, 0.35, 16), e }); }
    }
    X3 += lineSet('SubClassOf', scSegs);
    X3 += `<Switch DEF='TypesSw' whichChoice='-1'>${lineSet('TypeRays', typeSegs)}</Switch>`;
    X3 += lineSet('Threads', edgeSegs) + lineSet('SameAs', sameSegs) + lineSet('Routes', routeArcs.map(r => ({ pts: r.pts, cols: r.pts.map((_, i) => rgbaA(C.route, 0.35 + 0.4 * i / r.pts.length)) })));
    X3 += Object.entries(DYN).map(([d, cap]) => dynSet(d, cap)).join('');
    X3 += `<Group DEF='Beads'>` + [...nodes.values()].map(n => sprite(beadDef(n), beadApp(n), n.twin, beadSize(n))).join('') + `</Group>`;
    X3 += routeArcs.map((r, i) => `<Transform DEF='Mote${i}' translation='${f3(r.pts[0])}'><Billboard axisOfRotation='0 0 0'><Shape><Appearance USE='A_mote'/><IndexedFaceSet USE='Q'/></Shape></Billboard></Transform>`).join('');
    // the F2 ghost: a dashed amber box where the removed Box was
    { const bc = nodes.get(B + 'BareCube'); const s = 0.19; const P = []; for (const x of [-s, s]) for (const y of [-s, s]) for (const z of [-s, s]) P.push(f3([x, y, z]));
      X3 += `<Switch DEF='GhostSw' whichChoice='-1'><Transform translation='${f3(bc ? bc.object : [0, -50, 0])}' rotation='0.7071 0 -0.7071 0.9553'><Shape><IndexedLineSet colorPerVertex='false' coordIndex='0 1 3 2 0 -1 4 5 7 6 4 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1'><Coordinate point='${P.join(' ')}'/><ColorRGBA color='1 .7 .28 .95 1 .7 .28 .95 1 .7 .28 .95 1 .7 .28 .95 1 .7 .28 .95 1 .7 .28 .95'/></IndexedLineSet></Shape></Transform></Switch>`; }
    X3 += `<Group DEF='Fx'/><Group DEF='VarBeads'/>`;
    const tS = now();
    const frag = await browser.createX3DFromString(`<X3D profile='Immersive' version='4.0'><Scene>${X3}</Scene></X3D>`);
    R.fragChars = X3.length; R.fragParse_ms = +(now() - tS).toFixed(1);
    const roots = Array.from(frag.rootNodes); for (const r of roots) scene.addRootNode(r);
    const N = d => frag.getNamedNode(d);
    for (const [d, t] of [...Object.entries(APPS), ...CURS]) { const T = TEX[t]; N(d + 'PX').image = new X3D.SFImage(T.w, T.h, 4, new X3D.MFInt32(...T.px)); }
    const vp = N('TwinCam'); vp.set_bind = true;
    R.build_ms = +(now() - tb).toFixed(1); mark('built');
    for (const n of nodes.values()) { n.node = N(beadDef(n)); n.shape = N(beadDef(n) + 'S'); n.size = beadSize(n); n.app = beadApp(n); }
    for (const k of classes.values()) { k.node = N(clsDef(k)); k.shape = N(clsDef(k) + 'S'); }
    const fx = N('Fx'), varBeads = N('VarBeads');
    const V3 = a => new X3D.SFVec3f(a[0], a[1], a[2]);
    const sameCols = { lo: N('SameAsC').color.copy(), hi: new X3D.MFColorRGBA(...sameSegsHi.flatMap(s => [s[2], s[3]]).map(c => new X3D.SFColorRGBA(...c))) };
    const motes = routeArcs.map((r, i) => ({ node: N('Mote' + i), pts: r.pts }));
    for (const m of motes) m.node.scale = V3([0.12, 0.12, 0.12]);

    // dynamic line layer writer
    const setDyn = (def, segs) => { const cap = DYN[def]; const P = [], Cc = []; const n = Math.min(cap, segs.length);
      for (let i = 0; i < cap; i++) { if (i < n) { const s = segs[i]; P.push(V3(s[0]), V3(s[1])); Cc.push(new X3D.SFColorRGBA(...s[2]), new X3D.SFColorRGBA(...s[3])); } else { P.push(V3([0, -50, 0]), V3([0, -50, 0])); Cc.push(new X3D.SFColorRGBA(0, 0, 0, 0), new X3D.SFColorRGBA(0, 0, 0, 0)); } }
      N(def + 'P').point = new X3D.MFVec3f(...P); N(def + 'C').color = new X3D.MFColorRGBA(...Cc); return n; };

    // ---------------------------------------------------------------- camera tracking, FOV re-fit and projection for HTML labels
    const cam = { pos: CAM.eye.slice(), rot: CAM.rot.slice(), fov: CAM.fov }; let dirty = true;
    const eye = N('Eye');
    eye.addFieldCallback('stl', 'position_changed', v => { cam.pos = [v.x, v.y, v.z]; dirty = true; });
    eye.addFieldCallback('stl', 'orientation_changed', v => { cam.rot = [v.x, v.y, v.z, v.angle]; dirty = true; });
    function fitFov() { const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return; const a = W / H, A0 = 16 / 9, t0 = Math.tan(CAM.fov / 2);
      // keep the layout's horizontal framing when the stage is narrower than 16:9 (panel docked, phone)
      // fit the content (bays and most of the dome: horizontal half-angle 0.47 rad from the layout camera), never tighter than 0.56 rad vertically
      const f = W >= H ? Math.max(0.56, 2 * Math.atan(Math.tan(0.47) / a)) : 0.98; const fov = Math.min(1.9, f); if (Math.abs(fov - cam.fov) > 1e-3 || !R.fov) { vp.fieldOfView = fov; cam.fov = fov; } R.fov = +fov.toFixed(3); dirty = true; }
    fitFov(); new ResizeObserver(fitFov).observe(el);
    function project(p) { const Rm = mR([cam.rot[0], cam.rot[1], cam.rot[2], -cam.rot[3]]); const v = mp(Rm, sub(p, cam.pos)); const W = el.clientWidth, H = el.clientHeight; if (v[2] > -0.05) return null;
      const t = Math.tan(cam.fov / 2); const sx = W > H ? t * W / H : t, sy = W > H ? t : t * H / W; return [((v[0] / -v[2]) / sx + 1) / 2 * W, (1 - (v[1] / -v[2]) / sy) / 2 * H, -v[2]]; }
    window.__project = project;

    // ---------------------------------------------------------------- HTML labels with priority collision culling (HUD furniture is an obstacle)
    const labelsEl = $('#labels'); const labels = [];
    const addLabel = o => { const d = document.createElement('div'); d.className = 'lab ' + o.cls; d.innerHTML = o.html; labelsEl.appendChild(d); const L0 = Object.assign({ el: d, pri: 0, dx: 0, dy: 0, align: 'c', group: 'base' }, o); labels.push(L0); dirty = true; return L0; };
    const dropGroup = g => { for (let i = labels.length - 1; i >= 0; i--) if (labels[i].group === g) { labels[i].el.remove(); labels.splice(i, 1); } dirty = true; };
    const leadersEl = $('#leaders');
    const OBST = ['#title', '#legend', '#stSky', '#stTwin', '#stWorld', '#variantBadge', '#replayStrip', '#inspect', '#inst', '#hint'];
    function layoutLabels() { const placed = [], lead = []; const W = el.clientWidth, H = el.clientHeight; const r0 = el.getBoundingClientRect();
      for (const id of OBST) { const e = $(id); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && r.height && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0') placed.push([r.left - r0.left - 4, r.top - r0.top - 4, r.right - r0.left + 6, r.bottom - r0.top + 4]); }
      const order = labels.slice().sort((a, b) => b.pri - a.pri);
      for (const l of order) { const p = l.at && project(l.at); if (!p || l.hidden) { l.el.style.opacity = 0; continue; }
        const w = l.w || (l.w = l.el.offsetWidth), h = l.h || (l.h = l.el.offsetHeight);
        let x = p[0] + l.dx, y = p[1] + l.dy; if (l.align === 'c') x -= w / 2; else if (l.align === 'r') x -= w; if (l.valign === 'b') y -= h; else if (l.valign !== 't') y -= h / 2;
        if (l.force) { x = Math.max(6, Math.min(W - w - 6, x)); y = Math.max(6, Math.min(H - h - 6, y)); }
        const px = /cls/.test(l.cls) ? 6 : 3, py = /cls/.test(l.cls) ? 3 : 2; let box = [x - px, y - py, x + w + px, y + h + py];
        const off = box[0] < 0 || box[2] > W || box[1] < 0 || box[3] > H;
        let hit = placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]));
        if (hit && l.force) { for (const dy of [-1, 1, -2, 2, -3, 3, -4, 4]) { const y2 = y + dy * (h + 6); const b2 = [box[0], y2 - py, box[2], y2 + h + py]; if (b2[1] < 0 || b2[3] > H) continue; if (!placed.some(b => !(b2[2] < b[0] || b2[0] > b[2] || b2[3] < b[1] || b2[1] > b[3]))) { y = y2; box = b2; hit = false; break; } } }
        if ((off && !l.force) || (hit && !l.keep)) { l.el.style.opacity = 0; continue; }
        placed.push(box); l.el.style.opacity = l.op != null ? l.op : 1; l.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
        if (l.leader) { const q = project(l.leader); if (q) lead.push(`<line x1="${(x + 14).toFixed(1)}" y1="${(y + h).toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${l.leaderColor}" stroke-width="1" stroke-opacity=".8"/><circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="9" fill="none" stroke="${l.leaderColor}" stroke-width="1.3"/>`); } }
      leadersEl.innerHTML = lead.join(''); }
    // base labels: bay names (priority 1000, never culled), abstract classes always, concrete classes on demand (level of detail)
    for (const k of classes.values()) k.label = addLabel({ cls: 'cls' + (k.abstract ? ' up' : ''), html: esc(k.name) + `<span class="c"></span>`, at: k.pos, dy: k.abstract ? -14 : 14, pri: k.abstract ? 20 + k.height : 10, op: k.abstract ? 0.7 : 0.85, hidden: !k.abstract });
    for (const b of bays) addLabel({ cls: 'bay', html: `<em>${esc(b.num)}</em><span class="bt">${esc(b.title)}</span>`, title: b.title, at: [b.object[0], 0.02, b.object[2]], dy: 14, pri: 1000, valign: 't', force: true, keep: true });
    function placeStrata() { const s = (id, y) => { const p = project([0, y, -1.4]); if (p) $(id).style.top = Math.max(96, Math.min(el.clientHeight - 70, p[1])) + 'px'; };
      s('#stSky', DOME.y_low + 1.3); s('#stTwin', LAY.frame.twin.y0 + 0.4); s('#stWorld', 0.7); }
    const okMark = ok => ok ? '<span title="matches twin-layout.json counts" style="color:var(--green)">✓</span>' : '<span title="differs from twin-layout.json" style="color:var(--red)">✕</span>';
    $('#stSkyD').innerHTML = `TBox · <b>${classes.size}</b> classes ${okMark(R.counts.missingClasses === 0 && classes.size === LAY.counts.classes)}<br><b>${statedClasses.size}</b> stated by the scene`;
    $('#stTwinD').innerHTML = `ABox · <b>${individuals.size}</b> nodes ${okMark(R.counts.agree)}<br><b>${store.size.toLocaleString('en')}</b> triples`;
    $('#stWorldD').innerHTML = `X3D 4.1 · <b>${bays.length}</b> plinths`;

    // ---------------------------------------------------------------- inspect a bead (click without drag)
    const listVals = (head) => { const out = []; let n = head, g = 0; while (n && n.value !== RDF + 'nil' && g++ < 200) { const f = store.getObjects(n, T_FIRST, null)[0]; if (f) out.push(f.value); n = store.getObjects(n, T_REST, null)[0]; } return out; };
    function inspect(n) { if (!n) return; const lines = [];
      for (const q of store.match(nn(n.iri), null, null)) { const o = q.object; const ov = o.termType === 'NamedNode' ? short(o.value) : o.termType === 'BlankNode' ? '( ' + listVals(o).join(' ') + ' )' : JSON.stringify(o.value); lines.push(`  ${short(q.predicate.value)} ${ov}`); }
      $('#inspectBody').innerHTML = `<div class="eyebrow"><span>Twin bead</span><span>${n.kind === 'def' ? 'DEF' : n.kind === 'use' ? 'USE reference (owl:sameAs)' : n.kind === 'positional' ? 'unnamed: positional IRI' : 'document'}</span></div><h3>${esc(short(n.iri))}</h3>
        <pre>${esc(short(n.iri))}\n${esc(lines.join(' ;\n'))} .</pre><p style="font-size:12px;color:var(--dim);margin:8px 0 0">${lines.length} triples with this subject, live from the N3.js store of data/ttl/cabinet.ttl.txt <span class="g C">C</span></p>`;
      $('#inspect').classList.add('on'); selectBead(n); dirty = true; }
    let selected = null;
    function selectBead(n) { if (selected && selected !== n) { selected.shape.appearance = N(selected.app); dropGroup('sel'); } selected = n;
      if (n) { n.shape.appearance = N('A_sel'); addLabel({ group: 'sel', cls: 'bead', html: esc(short(n.iri)), at: n.twin, dy: -16, valign: 'b', pri: 950, force: true }); } }
    { const sel = $('#beadPick'); if (sel) { const opts = [...nodes.values()].filter(n => n.kind === 'def' || n.kind === 'use').sort((a, b) => a.local.localeCompare(b.local));
        sel.insertAdjacentHTML('beforeend', opts.map(n => `<option value="${esc(n.iri)}">${esc(n.local)}${n.kind === 'use' ? ' (USE)' : ''}</option>`).join(''));
        sel.addEventListener('change', () => { const n = nodes.get(sel.value); if (n) { inspect(n); const x = $('#inspectX'); if (x) x.focus(); } sel.value = ''; }); } }
    $('#inspectX').addEventListener('click', () => { $('#inspect').classList.remove('on'); if (selected) { selected.shape.appearance = N(selected.app); selected = null; dropGroup('sel'); } });
    { let down = null; el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, true);
      el.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
        let best = null, bd = 14; for (const n of nodes.values()) { const p = project(n.twin); if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = n; } } if (best) inspect(best); }, true); }

    // ---------------------------------------------------------------- one lens state machine: every lens entry starts from clear()
    const anims = []; const animate = (dur, fn, done) => { if (RM) { fn(1); done && done(); return; } anims.push({ t0: now(), dur, fn, done }); };
    const worldNode = def => { try { return browser.currentScene.getNamedNode(def); } catch (e) { return null; } };
    const saved = new Map(); const saveField = (node, f, key) => { const k = key + '.' + f; if (!saved.has(k)) saved.set(k, { node, f, v: node[f] && node[f].copy ? node[f].copy() : node[f] }); };
    const restoreFields = () => { for (const s of saved.values()) { try { s.node[s.f] = s.v; } catch (e) {} } saved.clear(); };
    const fxSprite = (appDef, geomDef, axis, t, s, rot) => { const sc = browser.currentScene; const T = sc.createNode('Transform'); T.translation = V3(t); T.scale = V3(s); if (rot) T.rotation = new X3D.SFRotation(...rot);
      const sh = sc.createNode('Shape'); sh.appearance = N(appDef); sh.geometry = N(geomDef);
      if (axis) { const bb = sc.createNode('Billboard'); bb.axisOfRotation = V3(axis); bb.children = new X3D.MFNode(sh); T.children = new X3D.MFNode(bb); } else T.children = new X3D.MFNode(sh);
      fx.children.push(T); return T; };
    const state = { lens: null, fault: null, view: 'station' };
    const setLensUI = () => { for (const b of $$('.lensB')) b.setAttribute('aria-pressed', String(b.dataset.lens === state.lens)); for (const b of $$('.fchip')) b.setAttribute('aria-pressed', String(b.dataset.f === state.fault)); };
    const touchedClasses = new Set();
    function classLabel(k, mode, count) { k.label.hidden = false; k.label.el.className = 'lab cls ' + mode; k.label.el.querySelector('.c').textContent = count != null ? count : ''; k.label.w = 0; k.label.pri = mode === 'gold' ? 400 + (count ? parseInt(String(count).replace(/\D/g, ''), 10) % 300 : 0) : 500; k.label.op = 1; touchedClasses.add(k); }
    function clear() {
      fx.children = new X3D.MFNode(); restoreFields(); dropGroup('fx');
      for (const n of nodes.values()) { n.shape.appearance = N(n.app); n.node.scale = V3([n.size, n.size, n.size]); }
      for (const k of touchedClasses) { k.shape.appearance = N(k.abstract ? 'A_clsUp' : 'A_clsLo'); k.label.el.className = 'lab cls' + (k.abstract ? ' up' : ''); k.label.el.querySelector('.c').textContent = ''; k.label.w = 0; k.label.pri = k.abstract ? 20 + k.height : 10; k.label.op = k.abstract ? 0.7 : 0.85; k.label.hidden = !k.abstract; }
      touchedClasses.clear();
      for (const d of Object.keys(DYN)) setDyn(d, []);
      N('SameAsC').color = sameCols.lo; N('CurUp').appearance = N('A_curUp'); N('GhostSw').whichChoice = -1; N('SubClassOf').visible = true;
      if (selected) { selected.shape.appearance = N(selected.app); selected = null; dropGroup('sel'); } $('#inspect').classList.remove('on');
      state.lens = null; setLensUI(); dirty = true;
    }
    const plinthTop = n => (n.bay ? [n.bay.object[0], 1.06, n.bay.object[2]] : [n.object[0], 0.05, n.object[2]]);
    const hitBead = (n, app = 'A_hit', k = 1.8) => { n.shape.appearance = N(app); n.node.scale = V3([n.size * k, n.size * k, n.size * k]); };
    const brightenWorld = def => { const m = worldNode(def); if (!m || !('emissiveColor' in m)) return false; saveField(m, 'emissiveColor', def); const e = m.emissiveColor; m.emissiveColor = new X3D.SFColor(Math.min(1, e.r * 0.4 + 0.55), Math.min(1, e.g * 0.4 + 0.72), Math.min(1, e.b * 0.4 + 0.8)); return true; };
    // path pluck (from P2): the edges a query walks, from each hit bead up its rdf:type to the queried class
    function pluckPath(hits, targetClassIri) { const segs = [];
      for (const n of hits) { const c0 = typeOf.get(n.iri); const k0 = c0 && classes.get(c0); if (!k0) continue; segs.push([n.twin, k0.pos, rgbaA(C.hit, 0.85), rgbaA(C.hit, 0.6)]);
        if (!targetClassIri) continue; // BFS up subClassOf to the target
        const prev = new Map([[c0, null]]); const q = [c0]; while (q.length) { const c = q.shift(); if (c === targetClassIri) break; const k = classes.get(c); if (!k) continue; for (const p of k.parents || []) if (!prev.has(p)) { prev.set(p, c); q.push(p); } }
        if (prev.has(targetClassIri)) { let c = targetClassIri; while (prev.get(c)) { const a = classes.get(prev.get(c)), b = classes.get(c); if (a && b) segs.push([a.pos, b.pos, rgbaA(C.hit, 0.7), rgbaA(C.hit, 0.95)]); c = prev.get(c); } } }
      const seen = new Set(); const uniq = segs.filter(s => { const k = f3(s[0]) + f3(s[1]); if (seen.has(k)) return false; seen.add(k); return true; });
      setDyn('PluckL', uniq); return uniq.length; }

    function vizSpot(hits, opts = {}) { state.lens = 'query'; setLensUI(); let cones = 0;
      const tcls = opts.targetClass ? classes.get(opts.targetClass) : null;
      hits.forEach((n, i) => { hitBead(n); if (n.element && /Material$/.test(n.element)) brightenWorld(n.local);
        if (cones < 32 && n.spatial !== false) { cones++; const top = [n.object[0], DOME.y_low - 0.1, n.object[2]], h = top[1] - n.object[1] + 0.05;
          const col = fxSprite('A_shaft', 'QD', [0, 1, 0], top, [0.34, RM ? h : 0.001, 0.34]); animate(700 + i * 60, k => { col.scale = V3([0.34, Math.max(0.001, h * ease(k)), 0.34]); });
          fxSprite('A_haloHit', 'Q', null, plinthTop(n), [1.0, 1.0, 1.0], [1, 0, 0, -1.5708]); } });
      if (tcls) { tcls.shape.appearance = N('A_clsHot'); classLabel(tcls, 'hot'); }
      // the stated classes of the hits light up too (concrete class labels appear only when touched)
      for (const c of new Set(hits.map(n => typeOf.get(n.iri)).filter(Boolean))) { const k = classes.get(c); if (k && k !== tcls) { k.shape.appearance = N('A_clsHot'); classLabel(k, 'hot'); } }
      for (const c of opts.classes || []) { const k = classes.get(c); if (k) { k.shape.appearance = N('A_clsHot'); classLabel(k, 'hot'); } }
      if (opts.pluck !== false) pluckPath(hits.slice(0, 40), opts.targetClass);
      // value tags grouped per plinth (P3)
      const groups = new Map(); for (const n of hits) { const g = n.bay ? n.bay.local : 'shelf'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); }
      let gi = 0; for (const arr of groups.values()) { const topB = arr.reduce((a, b) => (b.twin[1] > a.twin[1] ? b : a));
        const shown = arr.slice(0, 5); addLabel({ group: 'fx', cls: 'tag', html: shown.map(n => esc(n.local) + (opts.values && opts.values.get(n.iri) != null ? ` <span class="v">${esc(opts.values.get(n.iri))}</span>` : '')).join('<br>') + (arr.length > 5 ? `<br><span class="v">+${arr.length - 5} more</span>` : ''), at: [topB.twin[0], topB.twin[1] + 0.1, topB.twin[2]], dy: -6, valign: 'b', pri: 700 - gi++, force: true }); }
      dirty = true; }
    function vizShapes(results, opts = {}) { state.lens = 'shapes'; setLensUI();
      const byFocus = new Map(); for (const r of results) { const iri = expand(r.focus); if (!iri) continue; if (!byFocus.has(iri)) byFocus.set(iri, []); byFocus.get(iri).push(r); }
      let i = 0; for (const [iri, rs] of byFocus) { const n = nodes.get(iri) || varNodes.get(iri); if (!n) continue; const bad = rs.some(r => /Violation/.test(r.severity));
        n.shape.appearance = N(bad ? 'A_red' : 'A_amber'); n.node.scale = V3([0.62, 0.62, 0.62]);
        const base = n.spatial === false ? n.twin : n.object; const top = [base[0], n.twin[1] + 1.0, base[2]], h = top[1] - base[1];
        if (i < 16) { const bc = fxSprite(bad ? 'A_beacon' : 'A_beaconA', 'QD', [0, 1, 0], RM ? top : base, [0.6, RM ? h : 0.001, 0.6]);
          animate(900, k => { bc.scale = V3([0.6, Math.max(0.001, h * ease(k)), 0.6]); bc.translation = V3([base[0], base[1] + h * ease(k), base[2]]); });
          fxSprite(bad ? 'A_haloRed' : 'A_haloAmber', 'Q', null, plinthTop(n), [1.3, 1.3, 1.3], [1, 0, 0, -1.5708]); }
        if (i < 4) { const r = rs[0]; addLabel({ group: 'fx', cls: 'call ' + (bad ? 'bad' : 'warn'), html: `<div class="h">${bad ? '<span class="glyph x">✕</span>Violation' : '<span class="glyph w">!</span>Warning'} · ${esc(r.shape || '')}</div><div class="m">${esc(r.message || '')}</div><div class="f">focus ${esc(r.focus)}${r.value != null && r.value !== r.focus ? ' · value ' + esc(r.value) : ''}</div>`, at: top, dx: 16, dy: -6, align: 'l', valign: 'b', pri: 900 - i, force: true, leader: n.twin, leaderColor: bad ? C.red : C.amber }); }
        i++; }
      if (!results.length) for (const iri of opts.okTargets || []) { const n = nodes.get(iri); if (!n) continue; n.shape.appearance = N('A_ok'); n.node.scale = V3([0.5, 0.5, 0.5]); fxSprite('A_haloGreen', 'Q', null, plinthTop(n), [1.1, 1.1, 1.1], [1, 0, 0, -1.5708]);
        addLabel({ group: 'fx', cls: 'call good', html: `<div class="h"><span class="glyph ok">✓</span>Conforms</div><div class="f">${esc(short(iri))}</div>`, at: [n.object[0], n.twin[1] + 0.6, n.object[2]], valign: 'b', pri: 880, force: true }); }
      dirty = true; }
    function vizGold(res, focusIris = []) { state.lens = 'reason'; setLensUI(); N('SubClassOf').visible = false; N('CurUp').appearance = N('A_curGold');
      const segs = []; for (const [s, c] of res.sample || []) { const n = nodes.get(s), k = classes.get(c); if (n && k) segs.push([n.twin, k.pos, rgbaA(C.gold, 0.0), rgbaA(C.gold, 0.7)]); }
      // cap 120 visible gold rays (brief); the rest become +N pills on the classes
      const pick = segs.filter((_, i) => i % Math.max(1, Math.ceil(segs.length / 120)) === 0).slice(0, 120);
      if (RM) setDyn('GoldL', pick); else animate(1300, k => setDyn('GoldL', pick.map(s => [s[0], lerp3(s[0], s[1], ease(k)), s[2], rgbaA(C.gold, 0.7 * ease(k))])));
      const per = Object.entries(res.per_class || {}).sort((a, b) => b[1] - a[1]);
      for (const [c, cnt] of per.slice(0, 40)) { const k = classes.get(c); if (!k) continue; k.shape.appearance = N('A_clsGold'); classLabel(k, 'gold', '+' + cnt); }
      for (const iri of focusIris) { const n = nodes.get(iri); if (n) hitBead(n, 'A_gold', 2.0); }
      dirty = true; return pick.length; }
    function vizIdentity(focusIris, sameAs) { state.lens = 'query'; setLensUI(); if (sameAs) N('SameAsC').color = sameCols.hi;
      for (const iri of focusIris) { const n = nodes.get(iri); if (n) { hitBead(n, sameAs ? 'A_hit' : 'A_gold', 2.0); addLabel({ group: 'fx', cls: 'tag', html: esc(n.local), at: n.twin, dy: -14, valign: 'b', pri: 600, force: true }); } } dirty = true; }
    function vizClasses(classIris) { state.lens = 'query'; setLensUI(); const segs = [];
      for (const c of classIris) { const k = classes.get(c); if (!k) continue; k.shape.appearance = N('A_clsGold'); classLabel(k, 'gold'); } dirty = true; return segs; }

    // ---------------------------------------------------------------- worlds: the Cabinet or a variant (scene .xml + its Turtle twin)
    const VARS = Object.keys(LAY.variants);
    const varNodes = new Map();
    let worldBusy = null;
    async function setWorld(name) {
      if (name === world) return; const t = now(); hold();
      try { await browser.loadURL(new X3D.MFString(`data/scenes/${name}.xml`)); scene = browser.currentScene; for (const r of roots) scene.addRootNode(r); vp.set_bind = true; saved.clear(); }
      finally { release(); }
      world = name; varNodes.clear(); varBeads.children = new X3D.MFNode();
      for (const n of nodes.values()) n.node.visible = true;
      const V = LAY.variants[name];
      if (V) { for (const iri of V.removed_nodes || []) { const n = nodes.get(iri); if (n) n.node.visible = false; }
        for (const [iri, n0] of Object.entries(V.added_nodes || {})) { const n = Object.assign({}, n0); n.size = beadSize(n); n.app = beadApp(n);
          const T = scene.createNode('Transform'); T.translation = V3(n.twin); T.scale = V3([n.size, n.size, n.size]); const bb = scene.createNode('Billboard'); bb.axisOfRotation = V3([0, 0, 0]);
          const sh = scene.createNode('Shape'); sh.appearance = N(n.app); sh.geometry = N('Q'); bb.children = new X3D.MFNode(sh); T.children = new X3D.MFNode(bb); varBeads.children.push(T);
          n.node = T; n.shape = sh; n.bay = bayOf(Object.assign({}, n, { parent: n.parent })); varNodes.set(iri, n); } }
      const vb = $('#variantBadge'); if (name === 'cabinet') vb.classList.remove('on'); else { vb.textContent = '⚠ Variant · ' + name + (V ? ' · ' + V.what : ''); vb.classList.add('on'); }
      document.body.classList.toggle('variant', name !== 'cabinet');
      stillClock(); R.world = { name, ms: +(now() - t).toFixed(1) }; dirty = true; }
    const stillClock = () => { if (!RM) return; const c = worldNode('Clock'); if (c && 'enabled' in c) { try { c.enabled = false; R.clockStopped = true; } catch (e) {} } };
    let held = 0; const hold = () => { if (held++ === 0) { window.__noLoop = true; } }; const release = () => { if (--held === 0) window.__noLoop = false; };
    const goWorld = name => (worldBusy = (worldBusy || Promise.resolve()).then(() => setWorld(name)).catch(e => R.errors.push('world: ' + e.message)));

    // ---------------------------------------------------------------- stations
    const STA = ST.stations, TIERS = ST.tiers;
    const byId = new Map(STA.map(s => [s.id, s]));
    const progress = {}; // id -> 'ok' | 'no' | 'ex'
    let cur = 0, active = 'main', edited = false, lastRun = null;
    const langOf = (s, which) => { const j = which === 'try' ? s.try && s.try.job : s.jobs.main.spec; if (!j) return null; if (j.kind === 'reason') return 'n3'; if (j.kind === 'shacl') return (j.shapes_ttl ? 'turtle' : null); if (['select', 'ask', 'diff'].includes(j.kind)) return 'sparql'; if (j.kind === 'count' && s.editor) return 'turtle'; return null; };
    const rulesText = {}; const loadRules = async f => (rulesText[f] = rulesText[f] || await txt(MAN.content_paths[f]));
    async function textFor(s, which) { if (which === 'main') return s.editor ? s.editor.text : null; const j = s.try && s.try.job; if (!j) return null; if (j.kind === 'reason') return loadRules(j.rules_file); return j.query || j.shapes_ttl || null; }
    const paramOf = s => (s.editor && /\?min\b/.test(s.editor.text) ? { name: 'min', label: 'min_luminance', main: 0.2, try: 0.5 } : null);
    const graphVariant = j => { const g = (j && (j.graph || j.graph_a)) || []; return g.find(x => VARS.includes(x)) || 'cabinet'; };

    // rail
    const tiersEl = $('#tiers');
    tiersEl.innerHTML = TIERS.map(t => { const list = STA.filter(s => s.tier === t.id);
      return `<div class="tier"><button class="tierHead" data-tier="${esc(t.id)}" title="${esc(t.title)}"><span class="L">${esc(t.id === 'C' ? 'C' : t.id)}</span><span class="tx"><span class="t">${esc(t.title)}</span><br><span class="b">${list.length} station${list.length === 1 ? '' : 's'}</span></span></button>
        <ul class="stList">${list.map(s => `<li><button class="stBtn" data-id="${esc(s.id)}"><span class="id">${esc(s.id)}</span><span>${esc(s.title)}</span><span class="tick" aria-hidden="true"></span></button></li>`).join('')}</ul></div>`; }).join('');
    tiersEl.addEventListener('click', e => { const b = e.target.closest('.stBtn'); if (b) { openStation(STA.findIndex(s => s.id === b.dataset.id)); if (innerWidth <= 860) $('#panel').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); return; }
      const t = e.target.closest('.tierHead'); if (t) { if (!document.body.classList.contains('railopen') && innerWidth > 860) toggleRail(true); openStation(STA.findIndex(s => s.tier === t.dataset.tier)); } });
    const toggleRail = v => { const on = v != null ? v : !document.body.classList.contains('railopen'); document.body.classList.toggle('railopen', on); $('#railToggle').setAttribute('aria-expanded', String(on)); setTimeout(fitFov, 50); };
    $('#railToggle').addEventListener('click', () => toggleRail());
    if (innerWidth >= 1500) toggleRail(true);
    function updateRail() { for (const b of $$('.stBtn')) { const id = b.dataset.id; b.toggleAttribute('aria-current', false); if (id === STA[cur].id) b.setAttribute('aria-current', 'step'); const t = b.querySelector('.tick'); const p = progress[id]; t.className = 'tick ' + (p || ''); t.textContent = p === 'ok' ? '✓' : p === 'no' ? '✕' : p === 'ex' ? '≈' : ''; t.title = p === 'ok' ? 'live = oracle' : p === 'no' ? 'live ≠ oracle' : p === 'ex' ? 'explained difference' : ''; }
      for (const h of $$('.tierHead')) h.classList.toggle('cur', h.dataset.tier === STA[cur].tier);
      const done = Object.keys(progress).length; $('#progTxt').textContent = `${done} / ${STA.length}`; $('.prog i, #prog i').style.width = (100 * done / STA.length) + '%'; }

    // editor with a light syntax tint (a highlighted <pre> under a transparent textarea)
    const KW = /\b(PREFIX|SELECT|DISTINCT|WHERE|FILTER|OPTIONAL|NOT|EXISTS|ASK|COUNT|GROUP|BY|ORDER|DESC|ASC|BIND|AS|LIMIT|UNION|VALUES|a|true|false)\b/g;
    function tint(src, lang) { let h = String(src).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      h = h.replace(/(^|[ \t])(#[^\n]*)/gm, '$1\u0001c$2\u0002');
      if (lang === 'sparql') h = h.replace(/^(PREFIX[^\n]*)$/gm, '\u0001c$1\u0002');
      if (lang === 'sparql') h = h.replace(KW, '\u0001kw$1\u0002').replace(/([?$][A-Za-z_][\w]*)/g, '\u0001v$1\u0002');
      else h = h.replace(/(@prefix|=&gt;|\b(?:sh|rdf|rdfs|owl|x3do|lab|xsd):[A-Za-z_][\w-]*)/g, m => m.startsWith('@') || m === '=&gt;' ? '\u0001kw' + m + '\u0002' : '\u0001p' + m + '\u0002').replace(/([?$][A-Za-z_][\w]*)/g, '\u0001v$1\u0002');
      h = h.replace(/("[^\n"]*"|'[^\n']*')/g, '\u0001s$1\u0002').replace(/(?<![\w.#:&;])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w:])/g, '\u0001n$1\u0002');
      // resolve markers (comments win: strip inner markers inside a comment span)
      h = h.replace(/\u0001c([^\u0002]*)\u0002/g, (m, body) => '\u0001c' + body.replace(/\u0001\w+|\u0002/g, '') + '\u0002');
      return h.replace(/\u0001(kw|v|p|s|c|n)/g, '<span class="tk-$1">').replace(/\u0002/g, '</span>'); }
    function syncEditor() { const ta = $('#edTa'); if (!ta) return; const pre = $('#edPre'); const lang = ta.dataset.lang; pre.innerHTML = tint(ta.value, lang) + '\n';
      const n = ta.value.split('\n').length; $('#edGut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 60) + 'px'; ta.style.width = 'auto'; ta.style.width = Math.max(ta.scrollWidth, ta.parentElement.clientWidth) + 'px'; pre.style.width = ta.style.width; }

    const fmtCell = v => v == null ? '<span style="color:var(--faint)">—</span>' : typeof v === 'number' ? esc(+v.toPrecision(6)) : esc(v);
    function resultsTable(res, kind, style) {
      if (!res) return '';
      if (kind === 'count') return `<div class="cmp"><div><h4>Triples in the twin</h4><div class="v">${res.triples.toLocaleString('en')}</div></div><div><h4>Triples in your snippet</h4><div class="v">${esc(res.snippet_triples)}</div></div></div>`;
      if (kind === 'sha256') return `<div class="note mono" style="word-break:break-all">sha256(${esc(res.file)}) =<br>${esc(res.sha256)}<br>${res.bytes} bytes hashed in this browser (SubtleCrypto)</div>`;
      if ('ask' in res) return `<div class="verdict"><span class="badge ${res.ask ? 'ok' : 'idle'}">${res.ask ? '✓ true' : '○ false'}</span><span style="color:var(--ink2)">ASK answers yes or no, nothing else.</span></div>`;
      if (kind === 'diff') return `<div class="cmp"><div><h4>Cabinet</h4><div class="v">${res.count_a}</div></div><div><h4>After the insert</h4><div class="v">${res.count_b}</div></div></div><p style="margin-top:8px">${res.count} IRIs of the Cabinet are gone from the variant:</p>` + rowsTable(['iri'], res.values.map(v => ({ iri: v })), style);
      if (kind === 'reason') { const per = Object.entries(res.per_class || {}).sort((a, b) => b[1] - a[1]);
        return `<div class="cmp"><div><h4>New x3do types</h4><div class="v">+${res.added_x3do_types_on_scene_iris.toLocaleString('en')}</div></div><div><h4>Types after</h4><div class="v">${res.x3do_types_on_scene_iris_after.toLocaleString('en')}</div></div></div>
          <div class="sec">Focus nodes</div>` + rowsTable(['node', 'types', 'list'], Object.entries(res.focus).map(([k, f]) => ({ node: k, types: f.count, list: f.types.slice(0, 14).join(', ') + (f.types.length > 14 ? ` … +${f.types.length - 14}` : '') })), 'gold') +
          `<div class="sec">Classes gaining members</div>` + rowsTable(['class', 'new members'], per.map(([c, v]) => ({ class: short(c), 'new members': '+' + v })), 'gold'); }
      if (kind === 'shacl') { if (!res.results.length) return `<div class="verdict"><span class="badge ok">✓ conforms</span><span style="color:var(--ink2)">0 results · ${res.shapes_run} node shapes run</span></div>`;
        return `<div class="resWrap"><table class="res"><thead><tr><th></th><th>focus · shape</th><th>message · path · value</th></tr></thead><tbody>${res.results.slice(0, 40).map(r => { const bad = /Violation/.test(r.severity);
          return `<tr class="hl" data-iri="${esc(expand(r.focus) || '')}"><td>${bad ? '<span class="glyph x" title="Violation">✕</span>' : /Warning/.test(r.severity) ? '<span class="glyph w" title="Warning">!</span>' : '<span class="glyph" style="background:var(--dim)">i</span>'}</td><td>${esc(r.focus)}<br><span style="color:var(--dim)">${esc(r.shape)} · ${esc(String(r.severity).replace('sh:', ''))}</span></td><td><span class="msg">${esc(r.message)}</span>${r.path ? `<br><span style="color:var(--dim)">path</span> ${esc(r.path)}` : ''}${r.value != null ? `<br><span style="color:var(--dim)">value</span> ${esc(r.value)}` : ''}${r.fix ? `<br><span style="color:var(--dim)">fix</span> ${esc(r.fix)}` : ''}</td></tr>`; }).join('')}</tbody></table>${res.results.length > 40 ? `<div class="more">+${res.results.length - 40} more</div>` : ''}</div>`; }
      return rowsTable(res.vars, res.rows, style); }
    function rowsTable(vars, rows, style) { if (!rows.length) return `<div class="verdict"><span class="badge idle">○ 0 rows</span><span style="color:var(--ink2)">The query matched nothing.</span></div>`;
      const col = { spot: 'var(--hit)', red: 'var(--red)', gold: 'var(--gold)', amber: 'var(--amber)' }[style] || 'var(--hit)';
      const shown = rows.slice(0, 12);
      return `<div class="resWrap"><table class="res"><thead><tr>${vars.map(v => `<th>?${esc(v)}</th>`).join('')}</tr></thead><tbody>${shown.map(r => { const iri = vars.map(v => expand(r[v])).find(x => x && x.startsWith(B));
        return `<tr class="hl" data-iri="${esc(iri || '')}">${vars.map((v, i) => `<td>${i === 0 ? `<span class="sw" style="background:${col}"></span>` : ''}${fmtCell(r[v])}</td>`).join('')}</tr>`; }).join('')}</tbody></table>${rows.length > 12 ? `<div class="more">+${rows.length - 12} more rows (all ${rows.length} drive the 3D view)</div>` : ''}</div>`; }
    const gradeChip = g => `<span class="g ${esc(g)}" title="grade ${esc(g)}: ${g === 'C' ? 'confirmed' : g === 'L' ? 'likely' : 'suspected'}">${esc(g)}</span>`;
    const h12 = h => `<span title="${esc(h)}">${esc(String(h).slice(0, 12))}</span>`;
    function mcpBlock(s) { const m = s.mcp; if (!m || !m.tool) return '';
      const args = Object.fromEntries(Object.entries(m.args || {}).filter(([k]) => !k.startsWith('_')));
      const argStr = Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? (v.length > 120 ? JSON.stringify(v.slice(0, 120) + '…') : JSON.stringify(v)) : JSON.stringify(v)}`).join(', ');
      const call = (m.calls || [])[0];
      return `<div class="sec">MCP equivalent</div><div class="mcp"><code>${esc(m.tool)}(${esc(argStr)})</code>
        <div class="meta">${call ? `${call.executed ? 'executed' : 'not executed'} against x3d_mcp 7d3f1d5 · ${call.ms != null ? call.ms + ' ms' : ''} · response sha256 ${h12(call.response_sha256 || '')} · tool vs oracle: <b style="color:${call.parity && call.parity.status === 'equal' ? 'var(--green)' : 'var(--amber)'}">${esc(call.parity ? call.parity.status : 'n/a')}</b> ${gradeChip('C')}` : 'shown, not executed'}${m.note ? '<br>' + esc(m.note) : ''}</div>
        <div style="display:flex;gap:6px;margin-top:6px"><button class="ebtn" data-copy="${esc(m.tool + '(' + JSON.stringify(args) + ')')}">Copy call</button>${call && call.response_excerpt ? `<details class="rc" style="margin:0;flex:1"><summary>Response excerpt</summary><pre>${esc(call.response_excerpt)}</pre></details>` : ''}</div></div>`; }
    function numbersBlock(s) { if (!s.numbers || !s.numbers.length) return '';
      return `<div class="sec">Numbers and their sources</div><ul class="nums">${s.numbers.map(n => `<li><span class="v">${esc(typeof n.value === 'number' ? n.value.toLocaleString('en') : String(n.value).length > 18 ? String(n.value).slice(0, 16) + '…' : n.value)}</span><span class="w">${esc(n.what)} ${gradeChip(n.grade)}</span><span class="s">${esc(n.source)}</span></li>`).join('')}</ul>`; }
    function specialBlock(s) {
      if (s.fault_matrix || s.id === 'T4.7') return faultMatrixHTML();
      if (s.ladder) return ladderHTML(s.ladder);
      if (s.tool_lists) { const tl = s.tool_lists; const bk = Object.keys(tl).find(k => /^tools_[0-9a-f]{7}$/.test(k)) || 'tools_'; const a = new Set(tl.fork_13121b6 || []), b = tl[bk] || []; const added = b.filter(x => !a.has(x));
        return `<div class="sec">Tool list, live from the receipts</div><p>${b.length} tools at ${esc(bk.slice(6))} (${a.size} before this work at 13121b6; ${esc(tl.note || '')}). New: ${added.map(x => `<code class="mono" style="color:var(--teal)">${esc(x)}</code>`).join(', ')}. Prompts: ${esc((tl.prompts || ['build_scene', 'audit_scene', 'semantic_audit', 'animate_scene', 'convert_to_x3dom']).join(', '))}.</p>
          <div class="resWrap" style="max-height:220px"><table class="res"><tbody>${b.map(x => `<tr><td>${added.includes(x) ? '<span class="sw" style="background:var(--teal)"></span>' : '<span class="sw" style="background:var(--faint)"></span>'}${esc(x)}${added.includes(x) ? ' <span style="color:var(--teal)">new</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`; }
      if (s.walkthrough) { const w = s.walkthrough, w2 = s.walkthrough_shape; const steps = x => `<ol class="wsteps">${(x.steps || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol>`;
        const t1 = w.test || {}, t2 = (w2 || {}).test || {};
        return `<div class="sec">Walkthrough 1 · a query becomes a tool</div>${steps(w)}<details class="rc" open><summary>${esc(w.file)} · sha256 ${h12(w.sha256 || '')}</summary><pre>${esc(w.text)}</pre></details>
          <div class="note">Tested (${esc(t1.source || 'receipts/wire-tool.json')}): tools listed ${esc((t1.tools_list || []).map(x => x.name).join(', '))}; bright_materials(0.2) returned ${esc(((t1.calls || [])[0] || {}).result ? t1.calls[0].result.length : '?')} rows, (0.5) returned ${esc(((t1.calls || [])[1] || {}).result ? t1.calls[1].result.length : '?')}; stdio result equals in-memory: ${t1.stdio_equals_in_memory ? '✓' : '✕'} ${gradeChip('C')}</div>
          ${w2 ? `<div class="sec">Walkthrough 2 · a shape becomes a tool</div>${steps(w2)}<details class="rc"><summary>${esc(w2.file)} · sha256 ${h12(w2.sha256 || '')}</summary><pre>${esc(w2.text)}</pre></details>
          <div class="note">Tested (${esc(t2.source || '')}; mcp ${esc((t2.libs || {}).mcp || '')}, pyshacl ${esc((t2.libs || {}).pyshacl || '')}): tools listed ${esc((t2.tools_list || []).map(x => x.name).join(', '))}; check_half_clear() → conforms ${esc(String(((t2.call || {}).result || {}).conforms))}, ${esc((((t2.call || {}).result || {}).results || []).map(x => x.focus + ' ' + x.value).join(', '))}; equals the T5.4 oracle: ${(t2.vs_oracle || {}).equal ? '✓' : '✕'}; stdio equals in-memory: ${t2.stdio_equals_in_memory ? '✓' : '✕'} ${gradeChip('C')}</div>` : ''}
          ${w.client_config ? `<div class="sec">Add both to an MCP client</div><pre class="note mono" style="white-space:pre-wrap">${esc(JSON.stringify(w.client_config, null, 2))}</pre><p style="font-size:12px;color:var(--dim)">${esc(w.client_config_note || '')}</p>` : ''}`; }
      return ''; }
    function wireSummary() { try { const keys = Object.keys(WIRE).filter(k => !/about|source/.test(k)); return 'receipts/wire-tool.json: ' + keys.map(k => k + ' ' + (typeof WIRE[k] === 'object' ? JSON.stringify(WIRE[k]).slice(0, 90) : WIRE[k])).join(' · ').slice(0, 420); } catch (e) { return ''; } }
    const LAYERS = [['xsd', 'XSD'], ['semantic', 'x3d_mcp semantic'], ['lab_shacl', 'lab SHACL'], ['core_shacl', 'core SHACL'], ['sparql', 'SPARQL'], ['render', 'X_ITE render'], ['reasoner', 'OWL RL reasoner']];
    function faultMatrixHTML(curF) { const F = FM.faults; return `<div class="sec">Which layer catches which fault</div><div class="resWrap"><table class="mat"><thead><tr><th>Fault</th>${LAYERS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${Object.entries(F).map(([k, f]) => `<tr class="${curF && k === 'fault-' + curF ? 'cur' : ''}"><td><b>${esc(k.replace('fault-', ''))}</b> <span style="color:var(--dim)">${esc(f.what.slice(0, 44))}${f.what.length > 44 ? '…' : ''}</span></td>${LAYERS.map(([c]) => { const L0 = f.layers[c]; return L0 && L0.caught ? `<td class="y" title="${esc(L0.source || '')}">✓<span class="sr">caught</span></td>` : `<td class="n" title="${esc(L0 && L0.source || '')}">–<span class="sr">silent</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <p style="margin-top:8px;font-size:12px">✓ = the layer reports something on the variant that it does not report on the clean Cabinet. Source: receipts/fault-matrix.json ${gradeChip('C')}. The reasoner column is the OWL 2 RL closure: the full ontology has ${FM.reasoner_axioms_full_ontology.disjointWith} disjointWith, ${FM.reasoner_axioms_full_ontology.functionalProperties} functional and ${FM.reasoner_axioms_full_ontology.cardinalityAxioms} cardinality axioms over ${FM.reasoner_axioms_full_ontology.classes} classes, so it never objects. The ontology proposes, SHACL shapes dispose, the validator gates.</p>`; }
    function ladderHTML(ld, sceneKey = 'cabinet') { const rungs = FM.rungs; const L0 = (FM.ladder[sceneKey] || {}).rungs || [];
      return `<div class="sec">The Ladder · ${esc(sceneKey)}</div><p style="font-size:12px;color:var(--dim);margin:0 0 6px">Climb from rung 0 at the bottom. ✓ pass · ! amber note or warning · ✕ fail · – not run. First failing rung: <b style="color:var(--ink)">${esc((FM.ladder[sceneKey] || {}).first_fail == null ? 'none' : FM.ladder[sceneKey].first_fail)}</b> · first flag: <b style="color:var(--ink)">${esc((FM.ladder[sceneKey] || {}).first_flag == null ? 'none' : FM.ladder[sceneKey].first_flag)}</b> (receipts/fault-matrix.json ladder) ${gradeChip('C')}</p><ol class="ladder">${rungs.map(r => { const s = L0.find(x => x.rung === r.rung) || {}; const st = s.status || 'n/a'; const g = st === 'pass' ? '<span class="glyph ok">✓</span>' : st === 'fail' ? '<span class="glyph x">✕</span>' : st === 'warn' ? '<span class="glyph w">!</span>' : '<span class="glyph" style="background:var(--faint)">–</span>';
        return `<li class="${esc(st)}">${g}<b>${r.rung} · ${esc(r.name)}</b><span>${esc(s.detail || r.instrument)}<br><span class="mono" style="font-size:11px;color:var(--dim)">${esc(s.source || r.instrument)}</span></span></li>`; }).join('')}</ol>
        <div class="tryRow">${Object.keys(FM.ladder).map(k => `<button class="ebtn" data-ladder="${esc(k)}">${esc(k)}</button>`).join('')}</div>`; }

    function badgeHTML(kind, cmp, explained) {
      if (!cmp) return '<span class="badge idle">○ not run yet</span>';
      if (cmp.equal) return `<span class="badge ok">✓ LIVE ${esc(cmp.live)} = ORACLE ${esc(cmp.oracle)}</span>`;
      if (explained) return `<span class="badge ex">≈ LIVE ${esc(cmp.live)} · ORACLE ${esc(cmp.oracle)} · explained</span>`;
      if (cmp.why) return `<span class="badge idle">○ ${esc(cmp.why)}</span>`;
      return `<span class="badge no">✕ LIVE ${esc(cmp.live)} ≠ ORACLE ${esc(cmp.oracle)}</span>`; }

    function openStation(i, opts = {}) { if (i < 0 || i >= STA.length) return; cur = i; active = 'main'; edited = false; lastRun = null; state.view = 'station'; state.fault = null; setLensUI(); stopReplay();
      const s = STA[i]; const lang = langOf(s, 'main');
      $('#pEye').textContent = `${s.id} · ${{ explore: 'RDF', sparql: 'SPARQL', reason: 'RDFS reasoning', shacl: 'SHACL', gate: 'Gates', agent: 'Agents · MCP' }[s.kind] || s.kind}`;
      $('#pTitle').textContent = s.title; $('#pPos').textContent = `${i + 1} / ${STA.length}`; $('#pBadge').className = 'badge idle'; $('#pBadge').textContent = '○ not run yet';
      $('#bPrev').disabled = i === 0; $('#bNext').disabled = i === STA.length - 1;
      const runnable = ['count', 'select', 'ask', 'diff', 'reason', 'shacl', 'sha256'].includes(s.jobs.main.spec.kind);
      const prm = paramOf(s); const exp = s.jobs.main.python;
      const mis = String(s.misconception || '').replace(/^"|"$/g, '');
      $('#pBody').innerHTML = `<p class="concept">${esc(s.concept)}</p>
        ${mis ? `<div class="miscon"><span class="k">✕ Myth</span><span class="myth">“${esc(mis.replace(/^“|”$/g, ''))}”</span></div>` : ''}
        <p>${esc(s.story)}</p>
        ${s.moment ? `<div class="moment"><b>In the room:</b> ${esc(s.moment)}</div>` : ''}
        ${lang ? `<div class="sec">Edit and run</div><div class="edWrap"><div class="edBar"><span class="lang" id="edLang">${esc(lang)}</span><span id="edWhich" style="font:500 11.5px/1 var(--sans);color:var(--dim)">original</span><span class="sp"></span><span class="hint" id="edHint">Esc, then Tab, leaves the editor</span><button class="ebtn" id="edReset">Reset</button><button class="ebtn" id="edCopy">Copy</button><button class="ebtn run" id="edRun">Run ▸</button></div>
          <div class="ed"><div class="gut" id="edGut"></div><div class="edArea"><pre id="edPre" aria-hidden="true"></pre><textarea id="edTa" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${esc(lang)} editor (Ctrl+Enter runs)" data-lang="${esc(lang)}"></textarea></div></div></div>` :
          runnable ? `<div class="sec">Run</div><div><button class="ebtn run" id="edRun">Run ▸</button> <span style="color:var(--dim);font-size:12px">${s.jobs.main.spec.shapes_file ? 'all lab shapes, including SHACL-SPARQL; about 2–3 s in headless Chromium 153 (L)' : ''}</span></div>` : ''}
        ${prm ? `<label class="param">${esc(prm.label)} <input id="edParam" type="number" step="0.05" min="0" max="1" value="${prm.main}"> <span style="font-family:var(--sans);color:var(--dim)">bound to ?${esc(prm.name)} as the tool does</span></label>` : ''}
        ${s.try && s.try.edit ? `<div class="tryRow"><button class="trychip" id="tryBtn" aria-pressed="false"><span class="k">Try this edit</span>${esc(s.try.edit)}</button></div>` : ''}
        <div id="resBox" aria-live="polite"></div>
        <div id="cmpBox"></div>
        ${specialBlock(s)}
        ${s.id === 'T4.8' ? `<div class="tryRow"><button class="ebtn" id="bLook">Bind the scene's LookAway viewpoint</button><button class="ebtn" id="bBack">Back to the twin camera</button></div>` : ''}
        ${s.kind === 'agent' && (s.id === 'T5.3' || s.id === 'T5.1') ? `<div class="tryRow"><button class="ebtn run" id="bOpenReplay">${s.id === 'T5.3' ? 'Open recorded session S4 (a stranger\'s scene: fault F5) ▸' : 'Open the recorded agent sessions ▸'}</button></div>` : ''}
        ${s.editorialCorrections?.length ? `<div class="note">Editorial update ${esc(s.editorialCorrections.join(", "))}. Original source and historical receipts are retained; <a href="workbench.html#integrity" style="color:var(--teal)">inspect the evidence boundary ↗</a>.</div>` : ""}
        ${mcpBlock(s)}
        ${numbersBlock(s)}
        <details class="rc"><summary>Receipts for this station</summary><div class="body">python vs js: ${esc(s.parity && s.parity.python_vs_js)} · tool vs oracle: ${esc(s.parity && s.parity.tool_vs_oracle)}
graph: ${esc((s.graph_files || []).join(', '))}
oracle job: receipts/oracle.json jobs['${esc(s.id)}:main'] (rdflib 7.6.0 / pyshacl 0.40.2 / owlrl 7.6.2)
JS cross-check: receipts/js.json (N3.js 2.13.12 / Comunica rdfjs-lite 5.4.1 / shacl-engine 1.1.3)${(PAR.jobs[s.id + ':main'] || {}).note ? '\nnote: ' + esc(PAR.jobs[s.id + ':main'].note) : ''}${(PAR.jobs[s.id + ':try'] || {}).note ? '\ntry note: ' + esc(PAR.jobs[s.id + ':try'].note) : ''}</div></details>`;
      const ta = $('#edTa');
      if (ta) { ta.value = s.editor ? s.editor.text : ''; syncEditor();
        // Tab indents only after a key was typed in this visit to the editor; Escape releases Tab so focus can move on (as CodeMirror does)
        let typing = false; ta.addEventListener('focus', () => { typing = false; });
        ta.addEventListener('input', () => { edited = true; $('#edWhich').textContent = 'edited'; syncEditor(); });
        ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runStation(); return; }
          if (e.key === 'Escape') { typing = false; return; }
          if (e.key === 'Tab') { if (typing && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); syncEditor(); } return; }
          if (!e.ctrlKey && !e.metaKey && !e.altKey && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key) && !/^(Arrow|Page|Home|End|F\d)/.test(e.key)) typing = true; });
        $('#edReset').addEventListener('click', async () => { ta.value = await textFor(s, active) || ''; edited = false; $('#edWhich').textContent = active === 'try' ? 'try-this edit' : 'original'; syncEditor(); });
        $('#edCopy').addEventListener('click', () => copyText(ta.value, $('#edCopy'))); }
      const rb = $('#edRun'); if (rb) rb.addEventListener('click', () => runStation());
      const tb2 = $('#tryBtn'); if (tb2) tb2.addEventListener('click', async () => { const on = active !== 'try'; active = on ? 'try' : 'main'; tb2.setAttribute('aria-pressed', String(on));
        const ta2 = $('#edTa'); if (ta2 && !(prm)) { const t = await textFor(s, active); if (t != null) { ta2.value = t; ta2.dataset.lang = langOf(s, active) || ta2.dataset.lang; $('#edLang').textContent = ta2.dataset.lang; } }
        if (prm) $('#edParam').value = prm[active];
        edited = false; if ($('#edWhich')) $('#edWhich').textContent = on ? 'try-this edit' : 'original'; syncEditor(); runStation(); });
      for (const b of $$('#pBody [data-ladder]')) b.addEventListener('click', () => { const box = b.closest('.tryRow').previousElementSibling; box.outerHTML = ladderHTML(null, b.dataset.ladder).replace(/<div class="tryRow">[\s\S]*$/, ''); });
      const bl = $('#bLook'); if (bl) bl.addEventListener('click', () => { const v = worldNode('LookAway'); if (v) { v.set_bind = true; live('Bound the LookAway viewpoint: valid, and almost nothing on screen.'); } });
      const bk = $('#bBack'); if (bk) bk.addEventListener('click', () => { vp.set_bind = true; });
      const bo = $('#bOpenReplay'); if (bo) bo.addEventListener('click', () => openReplay(s.id === 'T5.3' ? 'S4' : 'S1'));
      wireCopy(); wireRowHover();
      $('#pBody').scrollTop = 0; updateRail();
      clear(); const v = graphVariant(s.jobs.main.spec); goWorld(v); if (/^fault-F\d$/.test(v)) { state.fault = v.slice(6); setLensUI(); }
      if (!opts.silent) live(`Station ${s.id}: ${s.title}.`);
      R.station = s.id;
      if (QS.get('autorun') === '1' && runnable) runStation();
    }
    const copyText = (t, btn) => { try { navigator.clipboard.writeText(t).then(() => { if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1200); } }, () => {}); } catch (e) {} };
    const wireCopy = () => { for (const b of $$('#pBody [data-copy]')) b.addEventListener('click', () => copyText(b.dataset.copy, b)); };
    const wireRowHover = () => { for (const tr of $$('#pBody tr.hl')) { tr.addEventListener('mouseenter', () => { const n = nodes.get(tr.dataset.iri) || varNodes.get(tr.dataset.iri); if (n) { n.node.scale = V3([n.size * 2.6, n.size * 2.6, n.size * 2.6]); } });
      tr.addEventListener('mouseleave', () => { const n = nodes.get(tr.dataset.iri) || varNodes.get(tr.dataset.iri); if (n) n.node.scale = V3([n.size * 1.8, n.size * 1.8, n.size * 1.8]); }); } };

    let running = false;
    async function runStation() { const s = STA[cur]; const which = active;
      const spec = which === 'try' ? s.try && s.try.job : s.jobs.main.spec; if (!spec) return null;
      if (!['count', 'select', 'ask', 'diff', 'reason', 'shacl', 'sha256'].includes(spec.kind)) return null;
      const exp = which === 'try' ? s.try.expected : s.jobs.main.python;
      const ta = $('#edTa'); let editText = null; const lang = langOf(s, which);
      if (ta && lang) editText = ta.value;
      const prm = paramOf(s); if (prm && editText != null) editText = editText.replace(/\?min\b/g, String(+$('#edParam').value));
      if (spec.kind === 'count') editText = ta ? ta.value : null;
      if (spec.kind === 'shacl' && !spec.shapes_ttl) editText = null;
      const job = Object.assign({ edit_lang: s.editor && s.editor.lang }, spec);
      const orig = await textFor(s, which); const isOrig = !ta || !edited || (orig != null && ta.value.trim() === orig.trim());
      if (running) return null; running = true;
      $('#pBadge').className = 'badge run'; $('#pBadge').textContent = '◌ running…'; const rb = $('#edRun'); if (rb) rb.setAttribute('aria-disabled', 'true');
      const v = graphVariant(spec); goWorld(v);
      const t = now(); let res, err = null;
      try { res = await engineClient.run(job, editText); } catch (e) { err = e; }
      const ms = now() - t; running = false; if (rb) { rb.removeAttribute('aria-disabled'); if (document.activeElement === document.body || !document.activeElement) rb.focus({ preventScroll: true }); }
      if (err) { $('#resBox').innerHTML = `<div class="note warn">✕ The engine refused this text: <span class="mono">${esc(err.message)}</span></div>`; $('#pBadge').className = 'badge no'; $('#pBadge').textContent = '✕ error'; live('Error: ' + err.message); R.runs[s.id + ':' + which] = { error: err.message }; return { error: err.message }; }
      const cmp = isOrig ? LabParity.compare(spec.kind, res, exp) : { equal: false, why: 'edited text: the oracle answers the original only', live: '' };
      const pj = PAR.jobs[s.id + ':' + which]; const explained = !cmp.equal && isOrig && pj && pj.status === 'expected';
      $('#pBadge').outerHTML = `<span id="pBadge">${badgeHTML(spec.kind, cmp, explained)}</span>`;
      $('#resBox').innerHTML = `<div class="sec">Live result · ${esc(which === 'try' ? 'try-this edit' : 'station')} · ${ms.toFixed(0)} ms</div>` + resultsTable(res, spec.kind, s.highlight && s.highlight.style);
      $('#cmpBox').innerHTML = `<div class="sec">Live vs oracle</div>${badgeHTML(spec.kind, cmp, explained)}
        <div class="cmp"><div><h4>Live · this browser</h4><div class="v">${esc(cmp.live != null ? cmp.live : '')}</div>${esc(engineClient.mode)} · ${res._ms} ms${res.ms_shacl_engine != null ? ` · validate ${res.ms_shacl_engine} ms` : ''}${res.n3_reason_ms != null ? ` · reason ${res.n3_reason_ms} ms` : ''} ${gradeChip('C')}</div>
        <div><h4>Oracle · Python</h4><div class="v">${esc(cmp.oracle != null ? cmp.oracle : '')}</div>${spec.kind === 'shacl' ? 'pyshacl 0.40.2' : spec.kind === 'reason' ? 'rdflib 7.6.0 fixpoint' : 'rdflib 7.6.0'} · receipts/oracle.json ${gradeChip('C')}</div></div>
        ${explained ? `<div class="note warn">≈ Explained difference (receipts/parity.json): ${esc(pj.note)}</div>` : ''}
        ${cmp.truncated ? `<div class="note">The stations file keeps ${exp.rows.length} of the oracle's ${exp.count} rows; each kept row is among the live rows.</div>` : ''}
        ${spec.kind === 'shacl' ? `<div class="note">shacl-engine 1.1.3 with its SHACL-SPARQL plugin: ${res.shapes_run} node shapes, ${res.sparql_constraints} SPARQL constraints run in this browser. Fixes applied as in the cross-check: P1 (rdfs:subClassOf copied into the shapes graph) and P10 (one sh:sparql per shape). ${res.unfixed ? `<br>Without the P1 fix the same shapes give <b>${res.unfixed.count}</b> results.` : ''}</div>` : ''}
        ${spec.kind === 'reason' && res.added_x3do_types_on_scene_iris > 5000 ? `<div class="note warn">⚠ Full RDFS closure: every rdfs:domain and rdfs:range applies at once, so one node collects many types. The lab's own reproducible measurement on the public Turtle; reasoning stays subclass-only everywhere else.</div>` : ''}`;
      wireRowHover();
      const key = s.id + ':' + which; R.runs[key] = { kind: spec.kind, equal: cmp.equal, explained: !!explained, live: cmp.live, oracle: cmp.oracle, ms: +ms.toFixed(1), engine_ms: res._ms, edited: !isOrig };
      if (isOrig && which === 'main') progress[s.id] = cmp.equal ? 'ok' : explained ? 'ex' : 'no'; else if (isOrig && !progress[s.id]) progress[s.id] = cmp.equal ? 'ok' : explained ? 'ex' : 'no';
      updateRail(); visualize(s, spec, res); if (s.kind === 'gate') { state.lens = 'gate'; setLensUI(); }
      $('#timing').innerHTML = `last run <b>${ms.toFixed(0)} ms</b> · ${esc(engineClient.mode)}`;
      live(`${s.id} ${which === 'try' ? 'try-this edit' : ''}: ${cmp.equal ? 'live equals oracle' : explained ? 'explained difference' : cmp.why ? cmp.why : 'live differs from oracle'}, ${cmp.live}.`);
      lastRun = { s, which, res, cmp }; return R.runs[key]; }

    function visualize(s, spec, res) { clear(); const hl = s.highlight || {}; const style = hl.style;
      const focus = hl.focus_iri ? [hl.focus_iri] : [];
      if (spec.kind === 'reason') { vizGold(res, focus.length ? focus : Object.keys(res.focus || {}).map(expand).filter(Boolean)); if (style === 'amber') for (const iri of focus) { const n = nodes.get(iri); if (n) hitBead(n, 'A_amber', 2.0); } return; }
      if (spec.kind === 'shacl') { const okT = (hl.targets || []).concat(focus); vizShapes(res.results, { okTargets: okT }); return; }
      if (spec.kind === 'diff') { const hits = res.values.map(expand).map(i => nodes.get(i)).filter(Boolean); for (const n of hits) hitBead(n, 'A_amber', 1.8); state.lens = 'query'; setLensUI();
        addLabel({ group: 'fx', cls: 'call warn', html: `<div class="h"><span class="glyph w">!</span>${res.count} positional IRIs shift</div><div class="f">insert one node: positional names after it shift, and some survive but now name another node</div>`, at: [0, 3.6, -3], valign: 'b', pri: 800, force: true }); dirty = true; return; }
      if (spec.kind === 'select' || spec.kind === 'ask') {
        const rows = res.rows || []; const vars = res.vars || [];
        const hitIris = new Set(); const values = new Map(); const clsHits = new Set();
        const pick = hl.var && vars.includes(hl.var) ? [hl.var] : vars;
        for (const r of rows) { for (const v of pick) { const iri = expand(r[v]); if (!iri) continue; if (iri.startsWith(B) && (nodes.has(iri))) hitIris.add(iri); else if (classes.has(iri)) clsHits.add(iri); }
          const numVar = vars.find(v => typeof r[v] === 'number'); const k = pick.map(v => expand(r[v])).find(i => i && i.startsWith(B)); if (numVar && k) values.set(k, r[numVar]); }
        for (const iri of focus) hitIris.add(iri);
        const target = (/subClassOf\*\s+x3do:(\w+)/.exec(spec.query || '') || [])[1];
        const hits = [...hitIris].map(i => nodes.get(i)).filter(Boolean);
        if (style === 'gold' && /sameAs/.test(spec.query || '')) { vizIdentity([...hitIris], true); return; }
        if (style === 'gold' && !hits.length && clsHits.size) { vizClasses([...clsHits]); return; }
        if (style === 'gold') { vizIdentity([...hitIris], false); return; }
        if (style === 'red') { vizShapes(hits.map(n => ({ focus: short(n.iri), shape: 'query', severity: 'sh:Violation', message: 'found by the query' })), {}); return; }
        vizSpot(hits, { values, targetClass: target ? X + target : null, classes: [...clsHits] }); return; }
      if (spec.kind === 'count') { state.lens = 'query'; setLensUI(); const all = [...nodes.values()]; all.forEach((n, i) => { if (!RM) animate(400 + (i % 30) * 25, k => { const s2 = n.size * (1 + 0.9 * Math.sin(Math.PI * k)); n.node.scale = V3([s2, s2, s2]); }); }); return; }
    }

    // ---------------------------------------------------------------- the fault bench
    async function bench(F) { stopReplay(); clear(); state.view = 'bench'; state.fault = F; setLensUI(); const name = 'fault-' + F; const f = FM.faults[name]; $('#pPos').textContent = 'bench';
      $('#pEye').textContent = `Fault bench · ${F}`; $('#pTitle').textContent = f.what; $('#pBadge').outerHTML = '<span id="pBadge" class="badge run">◌ loading variant…</span>';
      await goWorld(name);
      const labS = f.layers.lab_shacl || {}; const ids = labS.shapes || [];
      let res = null, ms = 0, readback = null;
      if (ids.length) { const t = now(); try { res = await engineClient.run({ kind: 'shacl', graph: [name, 'slice'], shapes_file: 'shapes/x3d-lab.shacl.ttl', only_ids: ids, inference: 'none' }, null); } catch (e) { R.errors.push('bench: ' + e.message); } ms = now() - t; }
      if (F === 'F1') { const m = worldNode('Ruby'); if (m) readback = m.diffuseColor.toString(); }
      // the 3D: findings on the twin, the ghost box for F2, the variant's own scene underneath
      clear(); state.fault = F; setLensUI();
      if (res) vizShapes(res.results.filter(r => (labS.focus || []).includes(r.focus) || !labS.focus), {});
      if (F === 'F2') { N('GhostSw').whichChoice = 0; const bc = nodes.get(B + 'BareCube'); if (bc) addLabel({ group: 'fx', cls: 'call warn', html: `<div class="h"><span class="glyph w">!</span>Gone from the variant</div><div class="f">:BareCube x3do:Box · valid X3D, draws nothing</div>`, at: [bc.object[0], bc.object[1] + 0.4, bc.object[2]], dx: -10, align: 'r', valign: 'b', pri: 870, force: true, leader: bc.object, leaderColor: C.amber }); }
      if (F === 'F6' || F === 'F4') { const sp = nodes.get(B + (F === 'F6' ? 'Gilt' : 'Spin')); if (sp && F === 'F6') addLabel({ group: 'fx', cls: 'call', html: `<div class="h">Graph-invisible</div><div class="f">the Turtle of F6 is isomorphic to the clean Cabinet: only the XML-order check sees USE before DEF</div>`, at: [sp.twin[0], sp.twin[1] + 0.5, sp.twin[2]], valign: 'b', pri: 860, force: true }); }
      const caught = LAYERS.filter(([c]) => f.layers[c] && f.layers[c].caught);
      const mt = res ? LabParity.compare('shacl', res, null) : null; // no oracle object for the subset: show the matrix's own focus list instead
      const liveFocus = res ? [...new Set(res.results.map(r => r.focus))] : [];
      const agree = res ? (labS.focus || []).every(x => liveFocus.includes(x)) : null;
      $('#pBadge').outerHTML = `<span id="pBadge" class="badge ${caught.length > 1 ? 'no' : caught.length ? 'ex' : 'ok'}">${caught.length ? '✕' : '✓'} caught by ${caught.length} of ${LAYERS.length} layers</span>`;
      $('#pBody').innerHTML = `<p class="concept">${esc(f.what)}</p>
        <div class="note">Variant loaded: <span class="mono">data/scenes/${esc(name)}.xml</span> (X_ITE) and <span class="mono">data/ttl/${esc(name)}.ttl.txt</span> (the twin). Bench card from receipts/fault-matrix.json ${gradeChip('C')}.</div>
        <div class="sec">Layers</div><div class="resWrap"><table class="mat"><tbody>${LAYERS.map(([c, l]) => { const L0 = f.layers[c] || {}; const ev = L0.evidence ? L0.evidence[0] : L0.check_ids ? L0.check_ids.join(', ') : L0.shapes ? L0.shapes.join(', ') + (L0.focus ? ' on ' + L0.focus.join(', ') : '') : L0.note || L0.detail || '';
          return `<tr><td>${L0.caught ? '<span class="glyph x" title="caught">✕</span>' : '<span class="glyph" style="background:var(--raise);color:var(--ink2);border:1px solid var(--dim)" title="silent">–</span>'} <b>${esc(l)}</b></td><td style="text-align:left;font:400 12px/1.4 var(--sans);color:var(--ink2)">${L0.caught ? 'catches it' : 'silent'}${ev ? ` · <span class="mono" style="font-size:11.5px">${esc(String(ev).slice(0, 170))}</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
        ${F === 'F1' ? `<div class="sec">Renderer clamps, graph does not</div><div class="note mono">diffuseColor in the file: 1.5 0.08 0.16<br>X_ITE reads 1.5 back as ${esc(readback ? readback.split(' ')[0] : '1')} (live readback: ${esc(readback || 'n/a')})</div><p>The prism still looks red. Only the shape sees it.</p>` : ''}
        ${res ? `<div class="sec">Live lab SHACL on the variant · ${ids.map(esc).join(', ')} · ${ms.toFixed(0)} ms</div>${resultsTable(res, 'shacl')}<div class="verdict">${agree ? `<span class="badge ok">✓ LIVE focus ${esc(liveFocus.join(', '))} = MATRIX ${esc((labS.focus || []).join(', '))}</span>` : `<span class="badge no">✕ LIVE ${esc(liveFocus.join(', '))} ≠ MATRIX ${esc((labS.focus || []).join(', '))}</span>`}</div>` : `<div class="note">No lab shape catches ${esc(F)}: nothing to run live.${F === 'F6' ? ' The Turtle of this variant is isomorphic to the clean Cabinet.' : ''}</div>`}
        ${faultMatrixHTML(F)}
        <div class="tryRow"><button class="ebtn" id="bBack2">◂ Back to station ${esc(STA[cur].id)}</button></div>`;
      $('#bBack2').addEventListener('click', () => openStation(cur));
      R.runs['bench:' + F] = { results: res ? res.count : null, focus: liveFocus, agree, ms: +ms.toFixed(1), readback, world: world };
      $('#timing').innerHTML = `bench ${esc(F)} <b>${ms.toFixed(0)} ms</b> · ${esc(engineClient.mode)}`;
      live(`Fault ${F}: ${f.what}. Caught by ${caught.map(c => c[1]).join(', ') || 'no layer'}.`);
      return R.runs['bench:' + F]; }

    // ---------------------------------------------------------------- recorded agent sessions (replay)
    let TR = null, rp = null;
    const loadTR = async () => { if (TR !== null) return TR; try { TR = await json('data/sessions/transcripts.json'); } catch (e) { TR = false; } return TR; };
    function stopReplay() { if (rp) { clearTimeout(rp.timer); rp = null; } $('#replayStrip').classList.remove('on'); document.body.classList.toggle('replaying', false); dirty = true; }
    const stripSVG = (from, to, label) => { const X0 = { llm: 70, tool: 280, twin: 490 }; const a = X0[from], b = X0[to];
      return `<defs><filter id="gl"><feGaussianBlur stdDeviation="2"/></filter></defs>
        ${['llm', 'tool', 'twin'].map(k => `<g><rect x="${X0[k] - 58}" y="18" width="116" height="40" rx="10" fill="rgba(5,10,22,.85)" stroke="${k === 'llm' ? '#9d8cff' : k === 'tool' ? '#3de6d1' : '#e8fbff'}" stroke-opacity=".7"/><text x="${X0[k]}" y="43" text-anchor="middle" fill="#e6eef7" font-family="Inter, sans-serif" font-size="12.5" font-weight="600">${k === 'llm' ? 'LLM agent' : k === 'tool' ? 'x3d_mcp tool' : 'Twin'}</text></g>`).join('')}
        <path d="M128 38 H222 M338 38 H432" stroke="rgba(160,200,255,.3)" stroke-width="1.5" stroke-dasharray="3 4"/>
        ${a != null && b != null ? (() => { const a2 = a + 62, b2 = b - 66, d = RM ? '0.01' : '0.7';   // run below the boxes (y 66), end beside the target box, never on its label
          return `<path d="M${a2} 58 Q${a2} 66 ${a2 + 8} 66 H${b2 - 8} Q${b2} 66 ${b2} 58" fill="none" stroke="${from === 'tool' ? '#3de6d1' : '#c8b8ff'}" stroke-opacity=".35" stroke-width="1"/>
          <circle r="6" cy="66" fill="${from === 'tool' ? '#3de6d1' : '#c8b8ff'}" filter="url(#gl)"><animate attributeName="cx" from="${a2}" to="${b2}" dur="${d}s" fill="freeze"/></circle><circle r="3.2" cy="66" fill="#fff"><animate attributeName="cx" from="${a2}" to="${b2}" dur="${d}s" fill="freeze"/></circle>`; })() : ''}`; };
    async function openReplay(sid) { const tr = await loadTR(); clear(); state.view = 'replay'; state.fault = null; setLensUI(); await goWorld('cabinet');
      $('#pEye').textContent = 'T5 · Agent replay'; $('#pTitle').textContent = 'An agent at work, packet by packet'; $('#pPos').textContent = 'replay';
      if (!tr) { $('#pBadge').outerHTML = '<span id="pBadge" class="badge idle">○ recording pending</span>';
        $('#pBody').innerHTML = `<div class="note warn">⚠ Recording pending: data/sessions/transcripts.json is not in this build yet. The sessions are recorded over real MCP stdio against the x3d_mcp branch; the page will play them once the file ships.</div><div class="tryRow"><button class="ebtn" id="bBack2">◂ Back to station ${esc(STA[cur].id)}</button></div>`; $('#bBack2').addEventListener('click', () => openStation(cur)); return; }
      const S = tr.sessions; const ses = S.find(x => x.id === sid) || S[0];
      $('#pBadge').outerHTML = `<span id="pBadge" class="badge ok">✓ recorded ${esc(String(tr.recorded_at).slice(0, 16).replace('T', ' '))}Z</span>`;
      $('#pBody').innerHTML = `<p class="concept">${esc(ses.task)}</p>
        <div class="note">Client: ${esc(tr.llm)}. Server: x3d_mcp ${esc(String(tr.server.commit).slice(0, 7))} over ${esc(tr.server.transport)} (mcp ${esc(tr.server.mcp)}), ${esc(tr.handshake ? tr.handshake.tools : '')} tools. Every call stores its arguments, latency and the sha256 of the result. ${gradeChip('C')}</div>
        <div class="rpCtl"><select class="ebtn" id="rpSel" aria-label="Session">${S.map(x => `<option value="${esc(x.id)}" ${x.id === ses.id ? 'selected' : ''}>${esc(x.id)} · ${esc(x.task.slice(0, 48))}</option>`).join('')}</select>
          <button class="ebtn run" id="rpPlay">Play ▸</button><button class="ebtn" id="rpStep">Step</button><button class="ebtn" id="rpRestart">Restart</button><span id="rpPos" class="mono" style="color:var(--dim);font-size:12px"></span></div>
        <ol class="steps" id="rpSteps">${ses.steps.map((st, i) => `<li class="${esc(st.kind)}" data-i="${i}"><span class="t">${(st.t_ms / 1000).toFixed(1)} s<br><span class="k">${esc(st.kind)}</span></span><span>${st.kind === 'call' ? `<code>${esc(st.tool)}(${esc(JSON.stringify(st.args || {}).slice(1, -1).slice(0, 200))})</code>` : st.kind === 'result' ? `<code>${esc(st.tool || '')} → ${esc(String(st.result_excerpt || '').slice(0, 220))}</code><br><span class="mono" style="font-size:11px;color:var(--dim)">${st.latency_ms != null ? st.latency_ms + ' ms · ' : ''}${st.result_sha256 ? 'sha256 ' + esc(String(st.result_sha256).slice(0, 12)) : ''}</span>` : esc(String(st.text || st.result_excerpt || '').slice(0, 400))}</span></li>`).join('')}</ol>
        <div class="sec">Outcome</div><p>${esc(typeof ses.outcome === 'string' ? ses.outcome : JSON.stringify(ses.outcome))}</p>
        <details class="rc"><summary>Caveats recorded with the sessions</summary><div class="body">${(tr.caveats || []).map(c => '· ' + esc(c)).join('\n')}</div></details>
        <div class="tryRow"><button class="ebtn" id="bBack2">◂ Back to station ${esc(STA[cur].id)}</button></div>`;
      $('#bBack2').addEventListener('click', () => { stopReplay(); openStation(cur); });
      $('#rpSel').addEventListener('change', e => openReplay(e.target.value));
      rp = { ses, i: -1, timer: null, playing: false };
      const show = i => { rp.i = i; const st = ses.steps[i]; for (const li of $$('#rpSteps li')) li.classList.toggle('cur', +li.dataset.i === i); const li = $(`#rpSteps li[data-i="${i}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
        $('#rpPos').textContent = `${i + 1} / ${ses.steps.length}`; $('#replayStrip').classList.add('on'); document.body.classList.toggle('replaying', true);
        const from = st.kind === 'call' ? 'llm' : st.kind === 'result' ? 'tool' : null, to = st.kind === 'call' ? 'tool' : st.kind === 'result' ? 'twin' : null;
        $('#replayStrip svg').innerHTML = stripSVG(from, to); $('#rpCap').textContent = st.kind === 'call' ? `call ${st.tool}` : st.kind === 'result' ? `${st.tool || ''} → ${String(st.result_excerpt || '').slice(0, 90)}` : `${st.kind}: ${String(st.text || '').slice(0, 100)}`;
        clear(); state.view = 'replay'; const hi = (st.highlight || []).map(h => h.startsWith('http') ? h : B + h.replace(/^:/, '')).map(x => nodes.get(x)).filter(Boolean);
        // a step that names no node still points somewhere: the document bead (the scene the tool works on)
        let fallback = false; if (!hi.length && (st.kind === 'call' || st.kind === 'result')) { const doc = [...nodes.values()].find(n => n.kind === 'document'); if (doc) { hi.push(doc); fallback = true; } }
        if (hi.length) { for (const n of hi) hitBead(n, fallback ? 'A_sel' : st.kind === 'result' ? 'A_hit' : 'A_gold', fallback ? 1.4 : 2.0); addLabel({ group: 'fx', cls: 'tag', html: hi.slice(0, 6).map(n => esc(n.local)).join('<br>') + (hi.length > 6 ? `<br><span class="v">+${hi.length - 6}</span>` : ''), at: hi[0].twin, dy: -14, valign: 'b', pri: 700, force: true }); }
        dirty = true; R.replay = { session: ses.id, step: i, highlighted: fallback ? 0 : hi.length, fallback }; };
      const next = () => { if (!rp) return; if (rp.i + 1 >= ses.steps.length) { rp.playing = false; $('#rpPlay').textContent = 'Play ▸'; return; } show(rp.i + 1);
        if (rp.playing) { const a = ses.steps[rp.i], b = ses.steps[rp.i + 1]; const d = b ? Math.max(450, Math.min(1500, (b.t_ms - a.t_ms) / 6)) : 900; rp.timer = setTimeout(next, RM ? 900 : d); } };
      $('#rpPlay').addEventListener('click', () => { if (!rp) return; rp.playing = !rp.playing; $('#rpPlay').textContent = rp.playing ? 'Pause ❚❚' : 'Play ▸'; if (rp.playing) next(); else clearTimeout(rp.timer); });
      $('#rpStep').addEventListener('click', () => { if (!rp) return; rp.playing = false; clearTimeout(rp.timer); $('#rpPlay').textContent = 'Play ▸'; next(); });
      $('#rpRestart').addEventListener('click', () => { if (!rp) return; clearTimeout(rp.timer); rp.i = -1; next(); });
      show(0); live(`Agent replay ${ses.id}: ${ses.task}`); return { sessions: S.length, steps: ses.steps.length }; }

    // ---------------------------------------------------------------- receipts drawer
    let drawerOpener = null;
    function drawer(tab) { const wasOpen = $('#drawer').classList.contains('on'); if (!wasOpen) drawerOpener = document.activeElement; $('#drawer').classList.add('on');
      for (const t of $$('#drawer .tab')) { t.setAttribute('aria-selected', String(t.dataset.tab === tab)); t.tabIndex = t.dataset.tab === tab ? 0 : -1; } const b = $('#drawerBody');
      if (!wasOpen) { const ft = $(`#drawer .tab[data-tab="${tab}"]`); if (ft) ft.focus(); }
      const row = (k, v, g = 'C', src = '') => `<tr><td>${esc(k)}</td><td>${v}</td><td>${gradeChip(g)}</td><td style="color:var(--dim)">${esc(src)}</td></tr>`;
      if (tab === 'pins') { const P = PINS; const sh = x => x ? h12(x) : '';
        b.innerHTML = `<table><thead><tr><th>What</th><th>Version · sha256</th><th>Grade</th><th>Source</th></tr></thead><tbody>
          ${row('X3D Ontology', `4.1 · ${sh(P.ontology.sha256)} · matches pin: ${P.ontology.matches ? '✓' : '✕'}`, 'C', 'receipts/pins.json ontology')}
          ${row('Ontology slice the browser loads', `${sh(P.ontology.slice.sha256)} · ${P.ontology.slice.bytes} bytes`, 'C', 'receipts/pins.json ontology.slice')}
          ${row('X3dToTurtle stylesheet', `${esc(P.stylesheet.revision)} · ${sh(P.stylesheet.sha256)}`, 'C', 'receipts/pins.json stylesheet')}
          ${row('Published examples reproduced', esc(P.stylesheet.self_test), 'C', 'receipts/pins.json stylesheet.self_test')}
          ${row('x3d_mcp tools commit', esc(String((MCP.server || {}).commit || '').slice(0, 7)) + ' · ' + esc((MCP.server || {}).commit || ''), 'C', 'receipts/mcp-calls.json server.commit')}
          ${row('x3d_mcp validators commit', esc(VAL.validator.commit) + ' · XSD ' + sh(VAL.validator.xsd_sha256) + ' · X3DUOM ' + sh(VAL.validator.x3duom_sha256), 'C', 'receipts/validation.json validator')}
          ${row('Faithful Turtle build', 'SaxonC-HE (saxonche ' + esc(((P.engines || {}).python_content_venv || {}).saxonche || '?') + ') · lxml ' + esc(((P.engines || {}).python_content_venv || {}).lxml || '?'), 'C', 'receipts/pins.json engines.python_content_venv')}
          ${row('Python oracle', Object.entries(PAR.engines.python || {}).filter(([k, v]) => typeof v === 'string').map(([k, v]) => esc(k) + ' ' + esc(v)).join(' · '), 'C', 'receipts/parity.json engines.python')}
          ${PAR.shacl_three_engines ? row('Three-engine SHACL parity', (() => { const t = PAR.shacl_three_engines; return `pyshacl ${esc(t.pyshacl || '')} · shacl-engine ${esc(t.versions['shacl-engine'])} · rdf-validate-shacl ${esc(t.versions['rdf-validate-shacl'])}: rdf-validate-shacl refuses ${t.rvs_refused_full} of ${t.full_cases} full cases (SHACL-SPARQL), equals pyshacl on ${t.rvs_equal_full} full and ${t.rvs_equal_core_only} of ${t.core_only_cases} Core-only cases`; })(), 'C', 'receipts/parity.json shacl_three_engines (receipts/shacl3.json)') : ''}
          ${row('Browser engines', LSTACK ? `N3.js ${esc(LSTACK.n3)} · Comunica rdfjs-lite ${esc(LSTACK.comunica)} · shacl-engine ${esc(LSTACK['shacl-engine'])} (with SHACL-SPARQL plugin)` : 'see vendor/lab-stack.json', 'C', 'vendor/lab-stack.json (esbuild of content/build/node_modules)')}
          ${row('vendor/lab-stack.js', LSTACK ? `${sh(LSTACK.sha256)} · ${LSTACK.bytes.toLocaleString('en')} bytes` : '', 'C', 'build/bundle.mjs')}
          ${row('X_ITE', esc(R.xiteVersion) + ' (live browser.version) · MIT, vendor/x_ite/LICENSE.md.txt', 'C', 'this browser')}
          ${row('This browser', esc((navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/) || [''])[0]) + ' · engines in ' + esc(engineClient.mode), 'C', 'navigator.userAgent')}
          ${row('Renders in the receipts', `Chromium ${esc(RENDER.engine.chromium)} · Playwright ${esc(RENDER.engine.playwright)} · ${esc(RENDER.engine.gl_renderer).slice(0, 60)}`, 'C', 'receipts/render.json engine')}
          ${row('Overview lit fraction', esc(((RENDER.cabinet || {}).shots || {}).Overview ? JSON.stringify(RENDER.cabinet.shots.Overview).match(/"lit[^,}]*/)?.[0] || '' : ''), 'C', 'receipts/render.json cabinet.shots.Overview')}
          ${row('Live twin counts', `${R.counts.individuals} nodes (layout ${LAY.counts.nodes}) · ${R.counts.layoutClasses} classes (layout ${LAY.counts.classes}) · ${R.counts.triples} triples · agree ${R.counts.agree ? '✓' : '✕'}`, 'C', 'N3.js store vs data/twin-layout.json counts')}
          </tbody></table>`; }
      if (tab === 'validation') { const S = VAL.summary;
        b.innerHTML = `<p>x3d_mcp validators at commit ${esc(VAL.validator.commit)} (XSD x3d-4.1.xsd, semantic diagnostics, profile check). Source: receipts/validation.json ${gradeChip('C')}</p><table><thead><tr><th>File</th><th>XSD</th><th>errors</th><th>warnings</th><th>infos</th><th>new vs clean</th><th>first XSD error</th></tr></thead><tbody>${Object.entries(S).filter(([k]) => k.endsWith('.x3d')).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.xsd_valid ? '<span style="color:var(--green)">✓ valid</span>' : '<span style="color:var(--red)">✕ invalid</span>'}</td><td>${v.errors}</td><td>${v.warnings}</td><td>${v.infos}</td><td>${esc((v.new_checks || []).join(', '))}</td><td>${esc(String(v.first_xsd_error || '').slice(0, 140))}</td></tr>`).join('')}</tbody></table>`; }
      if (tab === 'parity') { const s = PAR.summary;
        b.innerHTML = `<p>${esc(PAR.about)}</p><p><b>${s.jobs}</b> jobs: ${Object.entries(s.by_status).map(([k, v]) => `${v} ${esc(k)}`).join(' · ')}. Tool calls compared: ${s.tool_calls_compared} (${Object.entries(s.tool_by_status).map(([k, v]) => `${v} ${esc(k)}`).join(', ')}). ${gradeChip('C')}</p>
          <table><thead><tr><th>Station</th><th>Python vs JS</th><th>Tool vs oracle</th><th>Live in this browser</th></tr></thead><tbody>${STA.map(x => { const p = PAR.stations[x.id] || {}; const l = R.runs[x.id + ':main']; return `<tr><td>${esc(x.id)} ${esc(x.title)}</td><td>${esc(typeof p.python_vs_js === 'object' ? JSON.stringify(p.python_vs_js) : p.python_vs_js || (x.parity || {}).python_vs_js)}</td><td>${esc((x.parity || {}).tool_vs_oracle)}</td><td>${l ? (l.equal ? '<span style="color:var(--green)">✓ equal</span>' : l.explained ? '<span style="color:var(--amber)">≈ explained</span>' : '<span style="color:var(--red)">✕ ' + esc(l.error || 'differs') + '</span>') : '<span style="color:var(--dim)">not run</span>'}</td></tr>`; }).join('')}</tbody></table>`; }
      if (tab === 'sums') { b.innerHTML = '<p>Loading…</p>'; txt('data/receipts/SHA256SUMS.txt').then(t => { const st = $('#drawer .tab[data-tab="sums"]'); if (!$('#drawer').classList.contains('on') || !st || st.getAttribute('aria-selected') !== 'true') return; b.innerHTML = `<p>receipts/SHA256SUMS of the content tree (${t.trim().split('\n').length} files). <button class="ebtn" id="verifySums">Verify the shipped Turtle and shapes in this browser</button> <span id="vsOut"></span></p><pre>${esc(t)}</pre>`;
        $('#verifySums').addEventListener('click', async () => { const lines = t.trim().split('\n').map(l => l.split(/\s+/)); let ok = 0, bad = 0, n = 0;
          for (const [h, f] of lines) { const pub = MAN.content_paths[f]; if (!pub) continue; n++; const buf = new TextEncoder().encode(await txt(pub)); const d = await crypto.subtle.digest('SHA-256', buf); const hx = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); if (hx === h) ok++; else bad++; }
          R.sums = { ok, bad, n }; const vo = $('#vsOut'); if (vo) vo.innerHTML = bad ? `<span class="badge no">✕ ${bad} of ${n} differ</span>` : `<span class="badge ok">✓ ${ok} of ${n} files match</span>`; R.sums = { ok, bad, n }; }); }); }
      if (tab === 'page') { b.innerHTML = `<table><tbody>${row('Ready', (R.marks.ready / 1000).toFixed(2) + ' s', 'C', 'performance.now() in this browser')}${row('Turtle parse', R.parse_ms + ' ms · ' + R.counts.triples + ' + ' + sliceQuads.length + ' triples', 'C', 'N3.js')}${row('Overlay build', R.build_ms + ' ms (one createX3DFromString, ' + R.fragChars.toLocaleString('en') + ' chars, ' + R.fragParse_ms + ' ms)', 'C', 'this browser')}${row('Engine', esc(engineClient.mode) + (R.coldQuery_ms != null ? ' · warm-up query ' + R.coldQuery_ms + ' ms' : ''), 'C', 'this browser')}${row('CSP notes', 'X_ITE’s optional wasm helper and its PT_Sans fonts may be blocked by a strict host policy; rendering falls back and nothing in the lab needs them.', 'C', 'securitypolicyviolation events: ' + R.violations.length)}${row('Files', Object.keys(MAN.files).length + ' data and vendor files, each with source sha256', 'C', 'data/manifest.json')}</tbody></table>`; }
    }
    for (const t of $$('#drawer .tab')) t.addEventListener('click', () => drawer(t.dataset.tab));
    const closeDrawer = () => { $('#drawer').classList.remove('on'); const o = drawerOpener && document.contains(drawerOpener) ? drawerOpener : $('#bReceipts'); drawerOpener = null; if (o && o.focus) o.focus(); };
    $('#drawerX').addEventListener('click', closeDrawer);
    $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') closeDrawer(); });
    $('#drawer').addEventListener('keydown', e => { const tabs = $$('#drawer .tab'); const i = tabs.indexOf(document.activeElement); if (i >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); const j = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; drawer(tabs[j].dataset.tab); tabs[j].focus(); } });
    $('#bReceipts').addEventListener('click', () => drawer('pins'));

    // ---------------------------------------------------------------- dock + keyboard
    $('#bPrev').addEventListener('click', () => openStation(cur - 1)); $('#bNext').addEventListener('click', () => openStation(cur + 1));
    $('#runTop').addEventListener('click', () => { if (state.view !== 'station') openStation(cur); runStation(); });
    $('#bReset').addEventListener('click', async () => { stopReplay(); clear(); state.fault = null; setLensUI(); await goWorld('cabinet'); vp.set_bind = true; if (state.view !== 'station') openStation(cur, { silent: true }); live('Reset: the clean Cabinet, no lens.'); });
    $('#bTypes').addEventListener('click', () => { const on = $('#bTypes').getAttribute('aria-pressed') !== 'true'; $('#bTypes').setAttribute('aria-pressed', String(on)); N('TypesSw').whichChoice = on ? 0 : -1; });
    $('#bReplay').addEventListener('click', () => openReplay('S1'));
    for (const b of $$('.fchip')) b.addEventListener('click', () => bench(b.dataset.f));
    // lens buttons jump to the first station that teaches that lens
    const LENS_STATION = { query: 'T2.1', reason: 'T3.1', shapes: 'T4.1', gate: 'C.1' };
    for (const b of $$('.lensB')) b.addEventListener('click', async () => { const id = LENS_STATION[b.dataset.lens]; const i = STA.findIndex(s => s.id === id); if (i >= 0) { openStation(i); await runStation(); } });
    document.addEventListener('keydown', e => { if (e.target.closest && e.target.closest('textarea,input,select')) return; if ($('#drawer').classList.contains('on')) { if (e.key === 'Escape') closeDrawer(); return; }
      if (e.key === 'ArrowRight') { openStation(cur + 1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { openStation(cur - 1); e.preventDefault(); }
      else if (/^[1-5]$/.test(e.key)) openStation(STA.findIndex(s => s.tier === 'T' + e.key)); else if (e.key === 'c' || e.key === 'C') openStation(STA.length - 1);
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runStation(); });

    // footer: how to read the page
    $('#foot').innerHTML = `<details><summary><b>How to read the grades</b> ${gradeChip('C')} ${gradeChip('L')} ${gradeChip('S')} · what was checked</summary> ${gradeChip('C')} confirmed: computed here and re-checked by a second engine, or read from a pinned file. ${gradeChip('L')} likely: computed once. ${gradeChip('S')} suspected. <b>What was checked:</b> the supplied build records compare station answers and tool calls with a Python oracle; current runs are labelled separately. The complete raw upstream pipeline is not packaged. The twin counts are checked here against the layout. The ontology proposes, SHACL shapes dispose, the validator gates. No GPU frame rates are claimed.</details>`;

    // ---------------------------------------------------------------- frame loop: aurora shimmer, ROUTE motes, animations, labels
    const tt = [N('A_curLoTT'), N('A_curLo2TT'), N('A_curUpTT'), N('A_curGoldTT')]; let frames = 0;
    function frame() { if (window.__noLoop) { requestAnimationFrame(frame); return; } const t = now(); frames++;
      for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]; const k = (t - a.t0) / a.dur; try { a.fn(Math.min(1, k)); } catch (e) {} if (k >= 1) { anims.splice(i, 1); a.done && a.done(); } }
      if (!RM) { const s = t / 1000; tt[0].translation = new X3D.SFVec2f(s * 0.012, 0); tt[1].translation = new X3D.SFVec2f(-s * 0.008 + 0.3, 0); tt[2].translation = new X3D.SFVec2f(s * 0.006, 0); tt[3].translation = new X3D.SFVec2f(s * 0.01, 0);
        for (const [i, m] of motes.entries()) { const ph = ((s / 2.4) + i * 0.5) % 1; const f = ph * (m.pts.length - 1), j = Math.floor(f); const p = lerp3(m.pts[j], m.pts[Math.min(j + 1, m.pts.length - 1)], f - j); m.node.translation = V3(p); } }
      if (dirty || anims.length) { placeStrata(); layoutLabels(); dirty = false; }
      requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    window.addEventListener('resize', () => { for (const l of labels) l.w = 0; dirty = true; });

    // ---------------------------------------------------------------- ready
    await engInit.catch(e => R.errors.push('engine init: ' + e.message));
    const gl = browser.getContext && browser.getContext(); if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); R.gl = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
    R.wasm = (() => { try { return typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function'; } catch (e) { return false; } })();
    const startId = QS.get('station'); openStation(Math.max(0, STA.findIndex(s => s.id === startId)), { silent: true });
    setTimeout(() => $('#veil').classList.add('gone'), 60);
    mark('ready');
    $('#inst').innerHTML = `<div class="big">${(R.marks.ready / 1000).toFixed(2)}<small>s to ready</small> ${gradeChip('C')}</div><span style="color:var(--violet)">sky</span> ${classes.size} classes ${okMark(R.counts.missingClasses === 0 && classes.size === LAY.counts.classes)} · <span class="nw"><span style="color:var(--teal)">twin</span> ${individuals.size} nodes ${okMark(R.counts.agree)}</span><br><span class="pl">parse ${R.counts.triples.toLocaleString('en')} + ${sliceQuads.length.toLocaleString('en')} triples · ${R.parse_ms.toFixed(0)} ms<br></span><span class="bl">build ${R.build_ms.toFixed(0)} ms · X_ITE ${esc(R.xiteVersion)} · ${esc(engineClient.mode)}</span>`;
    $('#timing').innerHTML = `ready <b>${(R.marks.ready / 1000).toFixed(2)} s</b> · ${esc(engineClient.mode)}`;
    // warm the query engine with a real station-shaped query while idle (cold Comunica is slow), and parse the slice in the worker
    setTimeout(async () => { try { R.coldQuery_ms = await engineClient.warm(); await engineClient.preload(['cabinet', 'slice']); R.warm = true; } catch (e) { R.errors.push('warm: ' + e.message); } }, 80);
    R.fpsProbe = () => new Promise(res => { const f0 = frames, t0 = now(); setTimeout(() => res(+((frames - f0) / ((now() - t0) / 1000)).toFixed(1)), 2000); });
    window.__lab = { openStation: id => openStation(STA.findIndex(s => s.id === id), { silent: true }), run: () => runStation(), tryEdit: async id => { openStation(STA.findIndex(s => s.id === id), { silent: true }); const b = $('#tryBtn'); if (!b) return null; active = 'try'; b.setAttribute('aria-pressed', 'true'); const ta = $('#edTa'); const s = STA[cur]; const prm = paramOf(s); if (ta && !prm) { const t = await textFor(s, 'try'); if (t != null) { ta.value = t; ta.dataset.lang = langOf(s, 'try') || ta.dataset.lang; } } if (prm) $('#edParam').value = prm.try; edited = false; syncEditor(); return runStation(); },
      bench: F => bench(F), replay: sid => openReplay(sid), drawer, reset: () => $('#bReset').click(), stations: STA.map(s => s.id), world: () => world, project, nodes, classes };
  } catch (e) { R.errors.push(String(e && e.stack || e).slice(0, 800)); $('#veilErr').textContent = 'Error: ' + String(e.message || e).slice(0, 200); }
  R.done = true;
})();
