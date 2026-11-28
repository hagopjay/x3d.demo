// The task (turnpoint cylinders, sunset, landing out), the final-glide computer and the two bots.
import { terrainAt } from './level.js';
import { speedToFly, modelSink } from './polar.js';
import { createSpeedHold } from './glider.js';
import { dayLength, sunElevation } from './air.js';

export function createTask(level) {
  const tps = level.task.turnpoints;
  const task = {
    leg: 0, status: 'flying', finishTime: null, reached: [], log: [],
    get target() { return tps[Math.min(task.leg, tps.length - 1)]; },
    turnpoints: tps, day: dayLength(level),
    update(g, t) {
      if (task.status !== 'flying') return;
      const s = g.st, tp = tps[task.leg];
      if (Math.hypot(s.x - tp.x, s.y - tp.y) <= tp.r) {
        task.reached.push({ name: tp.name, t, z: s.z });
        if (tp.finish) { task.status = 'finished'; task.finishTime = t; return; }
        task.leg++;
      }
      const agl = s.z - terrainAt(level, s.x);
      if (agl <= 0) { task.status = 'landed out'; task.log.push({ t, x: s.x, y: s.y }); return; }
      if (t >= task.day) task.status = 'sunset';
    },
  };
  return task;
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Air-relative heading that makes good a ground track along unit (dx, dy) in a wind (u, 0); and the ground speed. */
export function windTriangle(Vh, dxu, dyu, u) {
  const dw = dxu * u, disc = dw * dw - u * u + Vh * Vh;
  const gs = disc > 0 ? dw + Math.sqrt(disc) : 0;
  return { psi: Math.atan2(gs * dyu, gs * dxu - u), gs };
}

/** Final glide: arrival height above the finish (m) at airspeed V, through still air plus the local wind. */
export function arrivalHeight(level, g, tp, V, u) {
  const s = g.st, dx = tp.x - s.x, dy = tp.y - s.y, d = Math.hypot(dx, dy);
  const sink = modelSink(V, g.mass());
  const { gs } = windTriangle(V, dx / d, dy / d, u);
  if (gs <= 0.5) return -Infinity;
  return s.z - terrainAt(level, tp.x) - (d / gs) * sink;
}

/**
 * kind 'mc': speed to fly from the polar, the local lift and an MC setting that falls with height; leaves for the
 * finish only when the final-glide computer shows 250 m in hand. kind 'naive': 190 km/h always, leaves at once.
 * Both steer the same way: along the ridge in its best lift band, holding a margin above the ground.
 */
export function createBot(kind, level, air, g, task) {
  const hold = createSpeedHold(g, { target: 30 });
  const ridge = { x0: 5950, x1: 7560 };
  let xStar = level.task.start.x, tSteer = 0, finalGlide = false;
  const bot = {
    kind, hold, get xStar() { return xStar; }, get finalGlide() { return finalGlide; }, mc: 0,
    update(dt) {
      const s = g.st;
      tSteer -= dt;
      if (tSteer <= 0) {
        tSteer = 0.5;
        const tp = task.target, here = air.sample(s.x, s.z);
        // the best lift band at this height with 150 m of clearance
        let best = -1e9, bx = xStar;
        for (let x = ridge.x0; x <= ridge.x1; x += 40) {
          if (s.z - terrainAt(level, x) < 150) continue;
          const w = air.sample(x, s.z).w - 0.0004 * Math.abs(x - s.x);
          if (w > best) { best = w; bx = x; }
        }
        if (best === -1e9) bx = ridge.x0 - 300;
        xStar = bx;
        const V = g.airspeed(), Vh = V * Math.cos(g.out.gamma || 0);
        let psiT;
        if (tp.finish) {
          const Vf = kind === 'naive' ? 190 / 3.6 : speedToFly(g.mass(), 0, 0.5, 0);
          const arr = arrivalHeight(level, g, tp, Vf, here.u);
          if (kind === 'naive' || arr >= 250 || finalGlide) finalGlide = true;
        }
        if (finalGlide) {
          const dx = tp.x - s.x, dy = tp.y - s.y, d = Math.hypot(dx, dy);
          psiT = windTriangle(Vh, dx / d, dy / d, here.u).psi;
        } else {
          // along the ridge toward the turnpoint (or back to the start's line while climbing for the final glide)
          const ty = tp.finish ? level.task.start.y : tp.y;
          const dir = Math.abs(ty - s.y) < 300 ? (bot.dir ?? 1) : Math.sign(ty - s.y);
          bot.dir = dir;
          const vgx = Math.max(-5, Math.min(5, 0.03 * (xStar - s.x)));
          const vax = vgx - here.u;
          const vay = dir * Math.sqrt(Math.max(1, Vh * Vh - vax * vax));
          psiT = Math.atan2(vay, vax);
        }
        bot.psiT = psiT;
        // speed
        if (kind === 'naive') hold.target = 190 / 3.6;
        else {
          const z0 = 1000 + 120;                        // the crest plus a margin
          bot.mc = Math.max(0, Math.min(2.5, (s.z - z0) / 150));
          hold.target = finalGlide ? speedToFly(g.mass(), here.w, 0.5, 0) : speedToFly(g.mass(), here.w, bot.mc, 0);
        }
      }
      const psi = Math.atan2(s.vy, s.vx - air.sample(s.x, s.z).u);
      g.ctl.bank = Math.max(-0.6, Math.min(0.6, -1.2 * wrap(bot.psiT - psi)));   // positive bank = right wing down = heading decreases
      hold.update(dt);
    },
  };
  return bot;
}

/** Fly a bot (or several on the same air) until each finishes, lands out or the sun sets. */
export function flyBots(level, air, entries, opts = {}) {
  const dt = 1 / 120, sub = Math.round(air.units.dt / dt);
  const maxT = opts.maxT ?? dayLength(level);
  let t = 0;
  while (t < maxT && entries.some((e) => e.task.status === 'flying')) {
    for (let k = 0; k < sub; k++) {
      for (const e of entries) {
        if (e.task.status !== 'flying') continue;
        e.bot.update(dt); e.g.step(dt);
        e.task.update(e.g, t + (k + 1) * dt);
        if (opts.trace && (Math.round((t + k * dt) * 120) % 600 === 0)) e.trace.push([+(t + k * dt).toFixed(1), Math.round(e.g.st.x), Math.round(e.g.st.y), Math.round(e.g.st.z), +(e.g.airspeed() * 3.6).toFixed(0)]);
      }
    }
    t += sub * dt;
    if (air.step % 300 === 0) air.setSun(sunElevation(level, t));
    air.advance(1);
  }
  return t;
}
