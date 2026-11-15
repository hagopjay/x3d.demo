// neutral timeline -> X3D: one TimeSensor, one interpolator per channel, two ROUTEs per channel.
import { INTERPOLATOR } from './model.js';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;');
const num = (x) => { const r = +x.toPrecision(9); return Object.is(r, -0) ? '0' : String(r); };
export const interpName = (ch) => `I_${ch.def}_${ch.field}`;

// opts: clock DEF (default 'Clock_<name>'), loop (true), startTime (1), prefix for DEFs to keep ids distinct from the scene's own
export function animationFragment(tl, { clock, loop = true, startTime = 1, indent = '    ' } = {}) {
  const ck = clock || 'Clock_' + tl.name.replace(/[^A-Za-z0-9_]/g, '_'), out = [];
  out.push(`${indent}<TimeSensor DEF='${esc(ck)}' cycleInterval='${num(tl.duration)}' loop='${loop}' startTime='${num(startTime)}'/>`);
  for (const ch of tl.channels) {
    const n = INTERPOLATOR[ch.type]; if (!n) throw new Error('no interpolator for ' + ch.type);
    out.push(`${indent}<${n} DEF='${esc(interpName(ch))}' key='${ch.keys.map((k) => num(k.t / tl.duration)).join(' ')}' keyValue='${ch.keys.map((k) => k.v.map(num).join(' ')).join(', ')}'/>`);
  }
  for (const ch of tl.channels) {
    out.push(`${indent}<ROUTE fromNode='${esc(ck)}' fromField='fraction_changed' toNode='${esc(interpName(ch))}' toField='set_fraction'/>`);
    out.push(`${indent}<ROUTE fromNode='${esc(interpName(ch))}' fromField='value_changed' toNode='${esc(ch.def)}' toField='${esc(ch.field)}'/>`);
  }
  return out.join('\n');
}
// insert the fragment before the last </Scene>; checks every animated DEF exists in the base scene
export function embed(baseX3d, tl, opts = {}) {
  const missing = [...new Set(tl.channels.map((c) => c.def))].filter((d) => !new RegExp(`DEF=(['"])${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`).test(baseX3d));
  if (missing.length) throw new Error('DEF not found in the scene: ' + missing.join(', '));
  const i = baseX3d.lastIndexOf('</Scene>'); if (i < 0) throw new Error('no </Scene> in the base scene');
  return baseX3d.slice(0, i) + `    <!-- animation '${esc(tl.name)}' (${tl.channels.length} channels, ${tl.channels.reduce((n, c) => n + c.keys.length, 0)} keys) -->\n` + animationFragment(tl, opts) + '\n  ' + baseX3d.slice(i);
}
