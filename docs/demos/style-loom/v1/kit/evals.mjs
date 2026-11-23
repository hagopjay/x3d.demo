// The evals socket: one metric and one task set that any optimizer can climb.
// Nothing here calls a model. A candidate is a function task -> style JSON; the metric
// scores what it returns. The deterministic repair operator is the baseline to beat.
//
// Task family A, "repair": a sentence that fails the grammar (made by transposing and
// inverting catalogue styles). Return a valid style that stays close to it.
// Task family B, "author": a brief in words (key, mood, encoding, surface). Return a
// style that satisfies the grammar and the brief. No baseline is run for B here.
import * as C from './color.mjs';
import { lint, transpose, invert, resolve, idOf, PARTS } from './grammar.mjs';
import { repair } from './repair.mjs';

export const FORMULA = 'score = 0.5 x grammar if any rule fails; else 0.5 + 0.5 x fidelity x brief';
export const FIDELITY_FULL_LOSS = 0.12;   // mean Delta E OK at which fidelity reaches 0

const flatPalette = p => [p.ground, p.plate, p.mass, p.ink, p.accent, p.alert, p.haze, ...p.sky, ...p.categorical, ...p.sequential];
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

/** Build the task set from a catalogue. Deterministic; split by FNV-1a hash of the task id (60% train, 40% dev). */
export function tasks(catalogue, scene) {
  const out = [];
  for (const st of catalogue) for (const pal of catalogue) for (const inv of [false, true]) {
    let s = idOf(st) === idOf(pal) ? st : transpose(st, pal);
    if (inv) s = invert(s);
    const l = lint(s, scene);
    if (l.ok) continue;
    const id = `repair/${idOf(st)}+${idOf(pal)}${inv ? '~inv' : ''}`;
    out.push({ id, family: 'repair', split: hash(id) < 0.6 ? 'train' : 'dev', input: s, fails: l.rules.filter(r => r.applies && !r.pass).map(r => r.id),
      brief: `Make this style pass the grammar while moving its colours as little as possible. It fails ${l.rules.filter(r => r.applies && !r.pass).map(r => `${r.id} (${r.name}: measured ${r.measured}, need ${r.need})`).join('; ')}.` });
  }
  for (const s of catalogue) {
    const r = resolve(s), id = `author/${idOf(s)}`;
    out.push({ id, family: 'author', split: hash(id) < 0.6 ? 'train' : 'dev', input: null, want: { key: s.intent.key, hue: r.encode.hue, model: r.surface.model },
      brief: `Write a complete style (all 10 parts of speech) for this intent. Lineage: ${s.lineage} Mood: ${s.intent.mood.join(', ')}. Use: ${s.intent.use}. Key: ${s.intent.key}. Encode hue by ${r.encode.hue}. Surface model: ${r.surface.model}.` });
  }
  return out;
}

/** Score one candidate style for one task. Returns { score, grammar, fidelity, brief, detail }. All parts are in 0..1. */
export function metric(task, candidate, scene) {
  let l;
  try { l = lint(candidate, scene); } catch (e) { return { score: 0, grammar: 0, fidelity: 0, brief: 0, detail: 'not a style: ' + e.message }; }
  const grammar = l.score;
  let fidelity = 1, brief = 1;
  if (task.family === 'repair') {
    const A = flatPalette(task.input.palette); let B;
    try { B = flatPalette(candidate.palette); } catch (e) { return { score: 0, grammar: 0, fidelity: 0, brief: 0, detail: 'no palette' }; }
    if (B.length !== A.length) fidelity = 0;
    else fidelity = Math.max(0, 1 - A.reduce((a, h, i) => a + C.deltaE(h, B[i]), 0) / A.length / FIDELITY_FULL_LOSS);
    // a repair may only touch the palette: structure tokens must be unchanged
    const a = resolve(task.input), b = resolve(candidate);
    const same = Object.keys(PARTS).filter(p => p !== 'palette').every(p => JSON.stringify(a[p]) === JSON.stringify(b[p]));
    brief = same ? 1 : 0;
  } else {
    const r = resolve(candidate), w = task.want;
    brief = [(candidate.intent || {}).key === w.key, r.encode.hue === w.hue, r.surface.model === w.model].filter(Boolean).length / 3;
  }
  // Fail the grammar and the score stays under 0.5. Pass it and the score is 0.5 plus half of fidelity x brief,
  // so a valid answer that throws the input away earns 0.5, never more. (The first weighting was additive and
  // let exactly that cheat outscore the honest repair, 0.70 to 0.67 on dev; see SPEC section 8.)
  const score = l.ok ? 0.5 + 0.5 * fidelity * brief : 0.5 * grammar;
  return { score: +score.toFixed(4), grammar, fidelity: +fidelity.toFixed(4), brief, ok: l.ok, detail: l.rules.filter(r => r.applies && !r.pass).map(r => r.id).join(' ') };
}

/** Run a candidate over tasks and average. candidate(task) may be async. */
export async function evaluate(candidate, taskList, scene) {
  const rows = [];
  for (const t of taskList) rows.push({ id: t.id, ...metric(t, await candidate(t), scene) });
  const mean = k => +(rows.reduce((a, r) => a + r[k], 0) / (rows.length || 1)).toFixed(4);
  return { n: rows.length, score: mean('score'), grammar: mean('grammar'), fidelity: mean('fidelity'), valid: rows.filter(r => r.ok).length, rows };
}

/** The three baselines that need no model. */
export const BASELINES = {
  identity: { note: 'return the failing style untouched: the floor', run: t => t.input },
  'home-palette': { note: 'throw the palette away and use the structure style\'s own: valid but unfaithful', run: (t, cat) => { const home = cat.find(s => t.id.startsWith(`repair/${idOf(s)}+`)); return { ...t.input, palette: home.palette, intent: home.intent }; } },
  repair: { note: 'deterministic lightness hill-climb (repair.mjs): the baseline to beat', run: (t, cat, scene) => repair(t.input, scene).style },
};
