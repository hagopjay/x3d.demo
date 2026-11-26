// Lint the "Kuhn Landscape" style sentence with x3d.style (xst/1), repair if needed, write both.
import { lint } from '/home/claude/src/x3d.loom/x3d.style/src/grammar.mjs';
import { repair } from '/home/claude/src/x3d.loom/x3d.style/src/repair.mjs';
import * as C from '/home/claude/src/x3d.loom/x3d.style/src/color.mjs';
import fs from 'node:fs';
const style = {
  '@id': 'xst:kuhn-landscape', '@type': 'Style', label: 'Kuhn Landscape',
  lineage: 'The ten family colours of the Landscape of Consciousness figure, lifted for a night sky; obsidian for Challenge drawn as silver light.',
  intent: { key: 'low', mood: ['contemplative', 'luminous'], use: 'a navigable map of theories of consciousness' },
  palette: { ground: '#06070f', plate: '#0d1020', mass: '#141a30', ink: '#eef1ff', accent: '#ffe9a8', alert: '#ffffff', haze: '#0a0d1c',
    sky: ['#010208', '#0a0d1c'],
    categorical: ['#ec3b2f', '#f59a23', '#f4e21c', '#a8cc3c', '#22b35a', '#35a9e0', '#5a6cf0', '#a157d6', '#ff2e93', '#8e97ad'],
    sequential: ['#1a1f4a', '#3a2f7a', '#8a3f9a', '#e0608a', '#ffd38a'] },
  surface: { model: 'physical', tint: 1, capTone: 0.1, roughness: 0.35, metallic: 0.3, opacity: 1, glow: 0.8 },
  light: { azimuth: 210, elevation: 38, intensity: 1, ambient: 0.25, shadow: 0, contact: 0.3, relief: 0.4 },
  air: { fog: 'none', range: 3 },
  line: { edges: 'data', weight: 1.5, links: 'tube', linkInk: 'accent', grid: 'rings' },
  form: { sides: 12, taper: 0.8, tiers: 3, inset: 0.2, cap: 'spike', fill: 0.7, lift: 0.4 },
  type: { family: 'SANS', size: 1, case: 'asis', density: 0.35 },
  motion: { pulse: 4, flow: 24 },
  encode: { hue: 'category', alert: 'glow' },
  view: { projection: 'perspective', start: 'hero' },
};
const show = (tag, r) => { console.log(tag, 'ok', r.ok, 'score', r.score); for (const x of r.rules) if (x.applies && !x.pass) console.log('  FAIL', x.id, x.name, x.measured, x.need, x.note); };
const r0 = lint(style); show('authored', r0);
let fixed = style, r1 = r0, rep = null;
if (!r0.ok) { rep = repair(style); fixed = rep.style || rep; r1 = lint(fixed); show('repaired', r1); }
console.log('categorical', JSON.stringify(fixed.palette.categorical));
fs.writeFileSync('/home/claude/loc/style/kuhn-landscape.style.json', JSON.stringify({ authored: style, lint_authored: r0, final: fixed, lint_final: r1, repair: rep && { drift: rep.drift, moved: rep.moved } }, null, 1));
