// A steady test driver: follows the road centre and holds the driven tyres near peak slip (a skilled foot).
import { roadCentre } from '../src/sim/level.js';
import { HZ } from '../src/sim/truck.js';

export function botInput(sim, opts = {}) {
  const lvl = sim.level, p = sim.out.pos, f = sim.out.fwd;
  const ahead = p.x + 8;
  const zc = roadCentre(lvl, ahead);
  const heading = Math.atan2(f.z, f.x), want = Math.atan2(zc - p.z, 8);
  const steer = Math.max(-1, Math.min(1, (want - heading) * 2.2));
  if (opts.feather === false) return { throttle: 1, steer };
  // a skilled foot: hold the worst driven wheel's slip ratio a little past the tyres' peak (20 %)
  const v = Math.max(1, Math.abs(sim.speed));
  let slip = 0;
  for (const w of sim.wheels) if (w.drive !== 0 && w.contact) slip = Math.max(slip, (w.omega * w.radius - sim.speed) / v);
  const state = sim.botState || (sim.botState = { throttle: 0.6 });
  state.throttle += (1 / 240) * 4.0 * (0.2 - slip) / 0.2;
  state.throttle = Math.max(0.08, Math.min(1, state.throttle));
  return { throttle: state.throttle, steer };
}

/** Drive until the summit, a fall, a roll, or `seconds`; also stops when stuck (no progress for 20 s). */
export function runBot(sim, seconds = 240, opts = {}) {
  let lastBest = -1, lastT = 0;
  const steps = seconds * HZ;
  for (let i = 0; i < steps && sim.status === 'driving'; i++) {
    sim.step(i < HZ * 2 ? { brake: 1 } : botInput(sim, opts));
    if (sim.best > lastBest + 1) { lastBest = sim.best; lastT = sim.time; }
    if (sim.time - lastT > 20) { sim.status = 'stuck'; break; }
  }
  return { status: sim.status, time: Math.round(sim.time * 10) / 10, best: Math.round(sim.best * 10) / 10 };
}
