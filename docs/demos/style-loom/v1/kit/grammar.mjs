// The style grammar: what a style must say (10 parts of speech), the rules a sentence
// must obey (G1..G14), and the operators that make new styles from old ones.
// Everything here is a pure function of the style JSON, so it runs anywhere.
import * as C from './color.mjs';

export const NS = 'https://hagopjay.github.io/x3d.loom/ns/style#';
export const VERSION = 'xst/1';

/** The ten parts of speech and the tokens each one owns. Kind drives mixing and the ontology. */
export const PARTS = {
  palette: { ground: 'color', plate: 'color', mass: 'color', ink: 'color', accent: 'color', alert: 'color', haze: 'color', sky: 'colors', categorical: 'colors', sequential: 'colors' },
  surface: { model: ['unlit', 'phong', 'physical'], tint: 'unit', capTone: 'signed', roughness: 'unit', metallic: 'unit', opacity: 'unit', glow: 'unit' },
  light: { azimuth: 'number', elevation: 'number', intensity: 'number', ambient: 'unit', shadow: 'unit', contact: 'unit', relief: 'unit' },
  air: { fog: ['none', 'linear', 'exp'], range: 'number' },
  line: { edges: ['none', 'ink', 'data'], weight: 'number', links: ['line', 'tube'], linkInk: ['ink', 'accent'], grid: ['none', 'lines', 'rings'] },
  form: { sides: 'number', taper: 'unit', tiers: 'number', inset: 'unit', cap: ['flat', 'spike'], fill: 'unit', lift: 'number' },
  type: { family: ['SANS', 'SERIF', 'TYPEWRITER'], size: 'number', case: ['asis', 'upper'], density: 'unit' },
  motion: { pulse: 'number', flow: 'number' },
  encode: { hue: ['category', 'value', 'mono'], alert: ['color', 'glow'] },
  view: { projection: ['perspective', 'ortho'], start: ['hero', 'plan', 'street'] },
};

/** The roles a scene may carry. A style never names a mark, only a role. */
export const ROLES = ['ground', 'plate', 'mass', 'alert', 'hero', 'edge', 'link', 'packet', 'grid', 'label', 'sky'];

export const DEFAULTS = {
  surface: { model: 'phong', tint: 1, capTone: 0.06, roughness: 0.8, metallic: 0, opacity: 1, glow: 0 },
  light: { azimuth: 220, elevation: 42, intensity: 1, ambient: 0.4, shadow: 0, contact: 0.4, relief: 0.5 },
  air: { fog: 'none', range: 3 },
  line: { edges: 'none', weight: 1, links: 'line', linkInk: 'ink', grid: 'none' },
  form: { sides: 4, taper: 1, tiers: 1, inset: 0.18, cap: 'flat', fill: 0.72, lift: 0.35 },
  type: { family: 'SANS', size: 1, case: 'asis', density: 0.35 },
  motion: { pulse: 0, flow: 0 },
  encode: { hue: 'category', alert: 'color' },
  view: { projection: 'perspective', start: 'hero' },
};

/** Fill in defaults so every token has a value. Returns a new object. */
export function resolve(style) {
  const out = { ...style };
  for (const part of Object.keys(PARTS)) out[part] = { ...(DEFAULTS[part] || {}), ...(style[part] || {}) };
  return out;
}

/** The colours a mark body can take under this style's encoding. */
export function dataColours(s) {
  const p = s.palette;
  if (s.encode.hue === 'category') return p.categorical;
  if (s.encode.hue === 'value') return [0, 0.25, 0.5, 0.75, 1].map(t => C.ramp(p.sequential, t));
  return [p.mass];
}
/** Body colour of a mark: the data colour pulled toward the neutral mass colour by (1 - tint). */
export function bodyColour(s, data) { return C.mix(s.palette.mass, data, s.surface.tint); }

const THRESH = {
  labelContrast: 4.5, figureGround: 0.10, categoryDE: 0.08, categoryCvdDE: 0.04, rampSpan: 0.30,
  alertDE: 0.15, accentBudget: 0.15, glowGround: 0.35, hazeDE: 0.08, edgeContrast: 1.6, pulseMin: 0.5, plateDE: 0.02, shadingCarries: 0.8, shadeVisible: 0.5,
};
export const THRESHOLDS = THRESH;

/**
 * Check a style against the grammar. `scene` is optional and only feeds the accent budget.
 * Returns { ok, score, rules:[{ id, name, applies, pass, measured, need, note }] }.
 * score = passed / applicable, the number an optimizer can climb.
 */
export function lint(styleIn, scene) {
  const s = resolve(styleIn);
  const p = s.palette || {};
  const rules = [];
  const add = (id, name, applies, pass, measured, need, note) => rules.push({ id, name, applies, pass: applies ? !!pass : null, measured, need, note });
  const r3 = v => (Number.isFinite(v) ? +v.toFixed(3) : v);

  // G1 completeness: every token of every part is present and of the right kind.
  const missing = [];
  const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  for (const [part, toks] of Object.entries(PARTS)) for (const [tok, kind] of Object.entries(toks)) {
    const v = s[part] && s[part][tok];
    const ok = kind === 'color' ? isHex(v) : kind === 'colors' ? Array.isArray(v) && v.length >= 2 && v.every(isHex)
      : Array.isArray(kind) ? kind.includes(v) : kind === 'unit' ? typeof v === 'number' && v >= 0 && v <= 1
        : kind === 'signed' ? typeof v === 'number' && v >= -1 && v <= 1 : typeof v === 'number';
    if (!ok) missing.push(`${part}.${tok}`);
  }
  add('G1', 'Complete sentence', true, missing.length === 0, missing.length, '0 missing tokens', missing.join(' ') || 'all 10 parts speak');
  if (missing.some(m => m.startsWith('palette.'))) return finish(rules);

  const bodies = dataColours(s).map(d => bodyColour(s, d));
  // G2 legibility: label ink on ground and on plate.
  const lc = Math.min(C.contrast(p.ink, p.ground), C.contrast(p.ink, p.plate));
  add('G2', 'Labels are legible', true, lc >= THRESH.labelContrast, r3(lc), `contrast >= ${THRESH.labelContrast}:1 (WCAG 2.x)`, 'ink on ground and on plate');
  // G3 figure and ground: a body separates from the plate by colour, or by an edge line that does.
  const fgMin = Math.min(...bodies.map(b => C.deltaE(b, p.plate)));
  const edgeHelps = s.line.edges !== 'none';
  const edgeCols = s.line.edges === 'data' ? dataColours(s) : [p.ink];
  const ec = edgeHelps ? Math.min(...edgeCols.map(e => C.contrast(e, p.plate))) : 0;
  // Shading can stand in for colour only where shade is visible: on a light body. The frame taught this rule:
  // an inverted Paper Maquette (black card on black ground) passed on shading alone and drew a black frame.
  const nearest = bodies.reduce((a, b) => (C.deltaE(b, p.plate) < C.deltaE(a, p.plate) ? b : a));
  const shaded = s.surface.model !== 'unlit' && s.light.shadow + s.light.contact >= THRESH.shadingCarries && C.lightness(nearest) >= THRESH.shadeVisible;
  add('G3', 'Figure separates from ground', true, fgMin >= THRESH.figureGround || (edgeHelps && ec >= THRESH.edgeContrast) || shaded,
    r3(fgMin), `Delta E OK >= ${THRESH.figureGround}, or an edge with contrast >= ${THRESH.edgeContrast}:1, or a light (L >= ${THRESH.shadeVisible}) lit surface with shadow + contact >= ${THRESH.shadingCarries}`,
    fgMin >= THRESH.figureGround ? 'by colour' : edgeHelps && ec >= THRESH.edgeContrast ? `by edge, contrast ${r3(ec)}:1` : shaded ? 'by shading' : 'nothing separates it');
  // G4 categories are distinct, also for colour-blind readers.
  const cat = s.encode.hue === 'category';
  const used = s.line.edges === 'data' ? p.categorical : p.categorical.map(d => bodyColour(s, d));
  const dn = C.minPairDeltaE(used).min;
  const dcv = Math.min(C.minPairDeltaE(used, 'deutan').min, C.minPairDeltaE(used, 'protan').min);
  add('G4', 'Categories are distinct', cat, dn >= THRESH.categoryDE && dcv >= THRESH.categoryCvdDE, r3(dn),
    `min pair Delta E OK >= ${THRESH.categoryDE}; >= ${THRESH.categoryCvdDE} under deutan and protan`, `colour-blind min ${r3(dcv)} (Machado 2009)`);
  // G5 order: a sequential ramp is monotone in lightness with enough span.
  const seq = s.encode.hue === 'value';
  const Ls = p.sequential.map(C.lightness);
  const diffs = Ls.slice(1).map((v, i) => v - Ls[i]);
  const mono = diffs.every(d => d > 0) || diffs.every(d => d < 0);
  const span = Math.abs(Ls[Ls.length - 1] - Ls[0]);
  add('G5', 'Order reads as order', seq, mono && span >= THRESH.rampSpan, r3(span), `monotone OKLab lightness, span >= ${THRESH.rampSpan}`, mono ? 'monotone' : 'lightness reverses');
  // G6 alert pops: the alert colour is far from every body colour and from the plate.
  const ad = Math.min(...bodies.map(b => C.deltaE(p.alert, b)), C.deltaE(p.alert, p.plate));
  add('G6', 'Alert pops out', true, ad >= THRESH.alertDE, r3(ad), `Delta E OK >= ${THRESH.alertDE} from every body and the plate`, 'pre-attentive pop-out');
  // G7 accent scarcity: alerts and heroes stay rare, or they stop meaning anything.
  const share = scene ? scene.marks.filter(m => m.alert || m.hero).length / scene.marks.length : null;
  add('G7', 'Accents are scarce', share !== null, share <= THRESH.accentBudget, r3(share), `<= ${THRESH.accentBudget} of marks`, 'checked on the scene');
  // G8 glow needs night.
  const glows = s.surface.glow > 0.5 || s.encode.alert === 'glow';
  const gl = C.lightness(p.ground);
  add('G8', 'Glow needs night', glows, gl <= THRESH.glowGround, r3(gl), `ground OKLab L <= ${THRESH.glowGround}`, 'a glow on a bright ground is only a flat colour');
  // G9 light agrees with surface.
  const unlit = s.surface.model === 'unlit';
  add('G9', 'Light agrees with surface', true, unlit ? s.light.shadow === 0 : s.light.intensity > 0,
    unlit ? s.light.shadow : s.light.intensity, unlit ? 'unlit surface casts no shadow (shadow = 0)' : 'lit surface has a key light', `model ${s.surface.model}`);
  // G10 air agrees with sky: fog colour sits on the horizon colour.
  const foggy = s.air.fog !== 'none';
  const hz = C.deltaE(p.haze, p.sky[p.sky.length - 1]);
  add('G10', 'Air agrees with sky', foggy, hz <= THRESH.hazeDE, r3(hz), `haze within Delta E OK ${THRESH.hazeDE} of the horizon`, 'else distant masses silhouette in the wrong colour');
  // G11 motion restraint.
  const moving = s.motion.pulse > 0;
  add('G11', 'Motion is restrained', moving, s.motion.pulse >= THRESH.pulseMin, s.motion.pulse, `pulse period >= ${THRESH.pulseMin} s (under 3 flashes a second, WCAG 2.3.1)`, '');
  // G12 plate is a quiet step off the ground.
  const pd = C.deltaE(p.plate, p.ground);
  add('G12', 'Plate is a quiet step', true, pd >= THRESH.plateDE && pd <= 0.2, r3(pd), `Delta E OK from the ground in ${THRESH.plateDE}..0.2`, 'districts read without shouting');
  // G13 a palette is portable: both scales present so any palette fits any structure.
  const port = p.categorical.length >= 4 && p.sequential.length >= 3;
  add('G13', 'Palette is portable', true, port, `${p.categorical.length} categorical, ${p.sequential.length} sequential`, '>= 4 categorical and >= 3 sequential stops', 'so transposition always has what it needs');
  // G14 declared key matches the palette: a low-key style has a dark ground, a high-key style a light one.
  const key = s.intent && s.intent.key;
  const band = key === 'low' ? gl <= 0.4 : key === 'high' ? gl >= 0.75 : key === 'mid' ? gl > 0.3 && gl < 0.85 : false;
  add('G14', 'Declared key is honest', true, band, r3(gl), 'intent.key low: L <= 0.4, mid: 0.3..0.85, high: >= 0.75', `declared ${key || 'nothing'}`);
  return finish(rules);
}
function finish(rules) {
  const app = rules.filter(r => r.applies);
  const passed = app.filter(r => r.pass).length;
  return { ok: passed === app.length, passed, applicable: app.length, score: +(passed / app.length).toFixed(4), rules };
}

// ---- Operators: new styles from old ones -------------------------------------------------

const clone = o => JSON.parse(JSON.stringify(o));

/** transpose: keep the structure of `style`, take the palette (and key) of `donor`. */
export function transpose(style, donor) {
  const out = clone(style);
  out.palette = clone(donor.palette);
  out.intent = { ...(style.intent || {}), key: donor.intent && donor.intent.key };
  out['@id'] = `xst:${idOf(style)}+${idOf(donor)}`;
  out.label = `${style.label} in ${donor.label} colours`;
  out.derivedFrom = [style['@id'], donor['@id']]; out.operator = 'transpose';
  return out;
}
/** invert: flip the lightness of every palette colour (day becomes night), reversing the declared key. */
export function invert(style) {
  const out = clone(style);
  const p = out.palette;
  for (const [k, kind] of Object.entries(PARTS.palette)) p[k] = kind === 'color' ? C.invertLightness(p[k]) : p[k].map(C.invertLightness);
  const key = style.intent && style.intent.key;
  out.intent = { ...(style.intent || {}), key: key === 'low' ? 'high' : key === 'high' ? 'low' : key };
  out['@id'] = `xst:${idOf(style)}~inv`; out.label = `${style.label}, inverted`;
  out.derivedFrom = [style['@id']]; out.operator = 'invert';
  return out;
}
/** mix: interpolate two styles. Numbers and colours blend (colours in OKLab); words switch at t = 0.5. */
export function mixStyles(a, b, t) {
  const A = resolve(a), B = resolve(b), out = clone(A);
  for (const [part, toks] of Object.entries(PARTS)) for (const [tok, kind] of Object.entries(toks)) {
    const x = A[part][tok], y = B[part][tok];
    if (kind === 'color') out[part][tok] = C.mix(x, y, t);
    else if (kind === 'colors') { const n = Math.max(x.length, y.length); out[part][tok] = Array.from({ length: n }, (_, i) => C.mix(C.ramp(x, n > 1 ? i / (n - 1) : 0), C.ramp(y, n > 1 ? i / (n - 1) : 0), t)); if (tok === 'categorical') out[part][tok] = Array.from({ length: n }, (_, i) => C.mix(x[i % x.length], y[i % y.length], t)); }
    else if (Array.isArray(kind)) out[part][tok] = t < 0.5 ? x : y;
    else out[part][tok] = tok === 'sides' || tok === 'tiers' ? Math.round(x + (y - x) * t) : +(x + (y - x) * t).toFixed(4);
  }
  out.intent = t < 0.5 ? clone(A.intent || {}) : clone(B.intent || {});
  out['@id'] = `xst:${idOf(a)}*${idOf(b)}@${t}`; out.label = `${a.label} × ${b.label} (${Math.round(t * 100)}%)`;
  out.derivedFrom = [a['@id'], b['@id']]; out.operator = 'mix';
  return out;
}
export const idOf = s => String(s['@id'] || '').replace(/^xst:/, '');

/** Flatten a style to token paths: [['palette.ground', '#05080d'], ...]. Used for X3D Metadata and for RDF. */
export function flatten(styleIn) {
  const s = resolve(styleIn), out = [];
  for (const [part, toks] of Object.entries(PARTS)) for (const tok of Object.keys(toks)) {
    const v = s[part][tok];
    out.push([`${part}.${tok}`, Array.isArray(v) ? v.join(' ') : String(v)]);
  }
  return out;
}
