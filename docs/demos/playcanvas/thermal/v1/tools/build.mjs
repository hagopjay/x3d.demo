// Regenerate the shipped X3D files from src/sim: levels/ridge-day.x3d and assets/glider.x3d.
//   node tools/build.mjs
import { writeFileSync } from 'node:fs';
import { generateRidgeDay, toX3D } from '../src/sim/level.js';
import { gliderX3D } from '../src/sim/model.js';

const root = new URL('..', import.meta.url);
writeFileSync(new URL('levels/ridge-day.x3d', root), toX3D(generateRidgeDay()));
writeFileSync(new URL('assets/glider.x3d', root), gliderX3D());
console.log('wrote levels/ridge-day.x3d, assets/glider.x3d');
