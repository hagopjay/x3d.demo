// d3-x3d emitter v2.2: x3d2.mjs plus a DEF hygiene pass.
// A DEF survives only if the scene USEs it, a ROUTE names it, or the page addresses it by name (SAI getNamedNode).
// Page-addressed names get an <EXPORT> so the scene declares its public interface and checkers can tell them apart.
export * from './x3d2.mjs';
import { Scene } from './x3d2.mjs';
export const PAGE_NAMES = /^(VP\d+|CLOCK|SQUASH|CM\d+|CT\d+|N\d+|NM\d+|NT\d+|H\d+|EC)$/;
export function defHygiene(xml, pageNames = PAGE_NAMES) {
  const refs = new Set();
  for (const m of xml.matchAll(/\bUSE='([^']+)'/g)) refs.add(m[1]);
  for (const m of xml.matchAll(/\b(?:fromNode|toNode)='([^']+)'/g)) refs.add(m[1]);
  const stats = { kept: 0, stripped: 0, exported: [] };
  const out = xml.replace(/ DEF='([^']+)'/g, (m, name) => {
    if (refs.has(name)) { stats.kept++; return m; }
    if (pageNames.test(name)) { stats.kept++; stats.exported.push(name); return m; }
    stats.stripped++; return '';
  });
  const exp = stats.exported.map(n => `<EXPORT localDEF='${n}' AS='${n}'/>`).join('\n    ');
  return { xml: exp ? out.replace('\n  </Scene>', `\n    ${exp}\n  </Scene>`) : out, stats };
}
const base = Scene.prototype.toString;
Scene.prototype.toString = function () {
  // LOD far level: an info node instead of an empty Group (same draw, no empty-group warning)
  const { xml, stats } = defHygiene(base.call(this).replaceAll('<Group/></LOD>', `<WorldInfo info='"far level: label hidden"'/></LOD>`).replace("d3-x3d bridge v1 (tools/build.mjs)", "d3-x3d bridge v2.2 (tools/build2.mjs + x3d3.mjs)"));
  this.defStats = stats; return xml;
};
