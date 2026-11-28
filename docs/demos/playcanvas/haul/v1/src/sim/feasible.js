// Can the truck climb this? A quasi-static traction budget for one pitch, used to design the levels and to test them.
// The truck climbs a uniform grade when the driven tyres' grip covers gravity, rolling resistance and the trailer:
//   needed    = (M_truck + M_trailer) g sin theta + rolling resistance of the undriven wheels + mud bulldozing
//   available = sum over driven wheels of mu_i Fz_i        (lockers on: every driven wheel gives its own mu Fz;
//                                                           open diffs: each axle gives 2 x its weaker wheel)
// Fz: the truck's weight (and the trailer's tongue share on the tandem), moved uphill-to-downhill on the slope by
// cg height / wheelbase. margin = available / needed - 1: > 0 climbs, < 0 spins out.
import { G, SURFACES, TRUCK, TRAILER, TYRE, surfaceMu, pressureEffect } from './spec.js';

export const NAIVE = { drive: '6x4', lockers: false, pressure: TYRE.pressure.nominal, ballast: 0 };
export const BEST = { drive: '6x6', lockers: true, pressure: TYRE.pressure.min, ballast: 0 };

export function truckMass(ballast = 0) {
  return TRUCK.mass + 6 * TRUCK.wheelMass + ballast;
}

export function trailerMass(payload) {
  return payload == null ? 0 : TRAILER.emptyMass + 4 * TRAILER.wheelMass + payload;
}

/**
 * Margin for one pitch. grade: tan theta (0.3 = 30 %). surface: id, or [left, right] for a split-mu pitch.
 * wetness 0..1, puddle m. setup: NAIVE / BEST or any { drive, lockers, pressure, ballast }. payload: kg or null.
 */
export function margin(grade, surface, wetness, setup, payload = null, puddle = 0) {
  const theta = Math.atan(grade);
  const mt = truckMass(setup.ballast || 0), mtr = trailerMass(payload);
  const tongue = mtr * TRAILER.tongueShare;
  const sides = Array.isArray(surface) ? surface : [surface, surface];
  const wheelbase = TRUCK.axles[0].x - (TRUCK.axles[1].x + TRUCK.axles[2].x) / 2;
  const shift = (TRUCK.cgHeight / wheelbase) * Math.sin(theta) * mt * G;     // N moved from the front to the tandem
  const loads = TRUCK.axles.map((a, k) => a.load * mt * G * Math.cos(theta) + (k === 0 ? -shift : shift / 2) + (k ? tongue * G * Math.cos(theta) / 2 : 0));
  let available = 0;
  TRUCK.axles.forEach((a, k) => {
    const driven = setup.drive === '6x6' || a.drive6x4;
    if (!driven) return;
    const fz = Math.max(0, loads[k]) / 2;
    const mu = sides.map((s) => {
      const sens = 1 - TYRE.loadSensitivity * (fz / TYRE.nominalLoad - 1);
      return surfaceMu(s, wetness, puddle) * pressureEffect(setup.pressure, s).grip * sens;
    });
    available += setup.lockers ? (mu[0] + mu[1]) * fz : 2 * Math.min(mu[0], mu[1]) * fz;
  });
  // Rolling resistance costs a driven wheel torque, not grip: it resists only through undriven wheels (the front
  // axle in 6x4, the trailer's). Mud bulldozing (sink) pushes on everything that rolls through it.
  const rr = Math.max(...sides.map((s) => SURFACES[s].rr * pressureEffect(setup.pressure, s).rr));
  const sink = Math.max(...sides.map((s) => SURFACES[s].sink));
  const undrivenTruck = setup.drive === '6x6' ? 0 : Math.max(0, loads[0]);
  const resist = rr * (undrivenTruck + (mtr - tongue) * G * Math.cos(theta)) + sink * (mt + mtr) * G * Math.cos(theta);
  const needed = (mt + mtr) * G * Math.sin(theta) + resist;
  return available / needed - 1;
}

/** The steepest grade (tan theta) with a given margin, by bisection. */
export function steepest(surface, wetness, setup, payload, wanted = 0, puddle = 0) {
  let lo = 0, hi = 1.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (margin(mid, surface, wetness, setup, payload, puddle) > wanted) lo = mid; else hi = mid;
  }
  return lo;
}
