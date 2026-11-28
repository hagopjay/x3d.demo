// Rewrite levels/*.x3d from the generator (src/sim/level.js). tests/level.test.mjs checks the shipped files match.
import { writeFileSync } from 'node:fs';
import { generate, toX3D } from '../src/sim/level.js';
const L = generate();
writeFileSync(new URL('../levels/spring-melt.x3d', import.meta.url), toX3D(L));
console.log('levels/spring-melt.x3d', L.nx, 'x', L.nz, 'cells of', L.dx, 'm;', L.houses.length, 'houses; tarn level', L.tarn.eta);
