// Two scripted plans for Spring Melt, as tapes of brush strokes (deterministic; the tests and the page replay them).
//   botPlan:   open the farmland as a washland (cut the south bank ridge upstream, x 440-600), dig down the clay
//              sill in the narrows, raise the levee's low spot, then spend the rest of the spoil on the levee crest
//              until the barrow is empty. It keeps every house dry.
//   naivePlan: raise the low spot with earth dug right behind it, until the barrow is empty. The water goes over
//              the rest of the old crest instead.
//   node tools/bot.mjs [bot|naive|nothing]   runs the storm on the CPU and prints the outcome
import { riverZ, leveeZ, fromX3D } from '../src/sim/level.js';
import { createEarthworks } from '../src/sim/earth.js';

const along = (x0, x1, step, f) => { for (let x = x0; x <= x1 + 1e-9; x += step) f(x); };

export function botPlan(level) {
  const E = createEarthworks(level);
  const s = (o) => E.stroke(o);
  for (let k = 0; k < 2; k++) along(440, 600, 10, (x) => s({ tool: 'dig', x, z: riverZ(x) - 31, radius: 16, amount: 0.6 }));
  for (let k = 0; k < 2; k++) along(1110, 1180, 10, (x) => s({ tool: 'dig', x, z: riverZ(x), radius: 22, amount: 0.5 }));
  for (let k = 0; k < 2; k++) along(860, 940, 10, (x) => s({ tool: 'raise', x, z: leveeZ(x), radius: 12, amount: 0.25 }));
  for (let pass = 0; pass < 40 && E.barrow > 1; pass++) along(560, 1060, 10, (x) => { if (E.barrow > 1) s({ tool: 'raise', x, z: leveeZ(x), radius: 12, amount: 0.1 }); });
  return E.strokes;
}

export function naivePlan(level) {
  const E = createEarthworks(level);
  along(860, 940, 10, (x) => E.stroke({ tool: 'dig', x, z: leveeZ(x) + 40, radius: 14, amount: 0.5 }));
  for (let pass = 0; pass < 40 && E.barrow > 1; pass++) along(860, 940, 10, (x) => { if (E.barrow > 1) E.stroke({ tool: 'raise', x, z: leveeZ(x), radius: 12, amount: 0.25 }); });
  return E.strokes;
}

export const PLANS = { bot: botPlan, naive: naivePlan, nothing: () => [] };

if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const { applyPlan } = await import('../src/sim/earth.js');
  const { runStormCPU } = await import('../src/sim/game.js');
  const L = fromX3D(readFileSync(new URL('../levels/spring-melt.x3d', import.meta.url), 'utf8'));
  const name = process.argv[2] || 'bot';
  const E = applyPlan(L, PLANS[name](L));
  const r = runStormCPU(L, E);
  console.log(JSON.stringify({ plan: name, strokes: E.strokes.length, cut: E.cut, fill: E.fill, barrow: E.barrow, money: E.money, imbalance: E.imbalance(), nFlooded: r.nFlooded, flooded: r.flooded.map((f) => (f ? 'X' : '.')).join(''), peakStage: r.peakStage, minFreeboard: r.minFreeboard, ledger: r.ledger }, null, 1));
}
