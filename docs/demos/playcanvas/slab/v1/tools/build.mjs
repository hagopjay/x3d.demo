// Writes assets/skier.x3d: SLAB's skier as an X3D 4.0 model built from primitives (feet at the origin, facing +x).
// The game loads it through src/game/x3d-pc.js; the Airbag Switch is flipped when the airbag is pulled.
import { writeFileSync, mkdirSync } from 'node:fs';
import { writeXML, el } from '../src/x3d/x3dxml.js';
const root = new URL('..', import.meta.url).pathname;
const mat = (DEF, c, r = 0.6, m = 0) => el('Appearance', {}, el('PhysicalMaterial', { DEF, baseColor: c, roughness: r, metallic: m }));
const use = (DEF) => el('Appearance', {}, el('PhysicalMaterial', { USE: DEF }));
const T = (DEF, t, kids, rot) => el('Transform', { DEF, translation: t, ...(rot ? { rotation: rot } : {}) }, kids);
const doc = el('X3D', { profile: 'Interchange', version: '4.0' },
  el('head', {}, el('meta', { name: 'title', content: 'SLAB skier' }), el('meta', { name: 'generator', content: 'x3d.slab/tools/build.mjs' })),
  el('Scene', {},
    T('Skier', '0 0 0', [
      T('SkiL', '0 0.03 0.13', el('Shape', {}, mat('Ski', '0.9 0.25 0.08', 0.35), el('Box', { size: '1.75 0.035 0.09' }))),
      T('SkiR', '0 0.03 -0.13', el('Shape', {}, use('Ski'), el('Box', { size: '1.75 0.035 0.09' }))),
      T('Boots', '0 0.14 0', el('Shape', {}, mat('Boot', '0.08 0.08 0.1', 0.5), el('Box', { size: '0.32 0.2 0.38' }))),
      T('Legs', '0.05 0.48 0', el('Shape', {}, mat('Pants', '0.12 0.14 0.22', 0.8), el('Cylinder', { radius: '0.13', height: '0.6' })), '0 0 1 -0.25'),
      T('Torso', '0.12 0.98 0', el('Shape', {}, mat('Jacket', '0.95 0.78 0.1', 0.55), el('Cylinder', { radius: '0.19', height: '0.55' })), '0 0 1 -0.35'),
      T('Head', '0.25 1.38 0', el('Shape', {}, mat('Helmet', '0.92 0.93 0.95', 0.3), el('Sphere', { radius: '0.13' }))),
      T('Pack', '-0.06 1.02 0', el('Shape', {}, mat('PackRed', '0.85 0.12 0.1', 0.6), el('Box', { size: '0.16 0.42 0.3' }))),
      T('PoleL', '0.2 0.62 0.3', el('Shape', {}, mat('Pole', '0.7 0.72 0.75', 0.3, 0.8), el('Cylinder', { radius: '0.012', height: '1.2' })), '0 0 1 -0.4'),
      T('PoleR', '0.2 0.62 -0.3', el('Shape', {}, use('Pole'), el('Cylinder', { radius: '0.012', height: '1.2' })), '0 0 1 -0.4'),
      el('Switch', { DEF: 'Airbag', whichChoice: '-1' },
        T('Bag', '-0.05 1.25 0', el('Shape', {}, el('Appearance', {}, el('PhysicalMaterial', { baseColor: '1 0.35 0.02', roughness: '0.4', emissiveColor: '0.25 0.06 0', transparency: '0.08' })), el('Sphere', { radius: '0.5' })))),
    ])));
mkdirSync(root + 'assets', { recursive: true });
writeFileSync(root + 'assets/skier.x3d', `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n${writeXML(doc)}\n`);
console.log('wrote assets/skier.x3d');
