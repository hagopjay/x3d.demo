// The sailplane's published polar and the drag polar CD = CD0 + k CL^2 fitted to it.
// Source: XCSoar, src/Polar/PolarStore.cpp (master branch, read 28 Nov 2026), entry
//   { "ASW-28 (15m)", 310, 200, 92.6, -0.571, 120.38, -0.875, 148.16, -1.394, 10.5, 55.555, 108, 235 }, // from SeeYou
// (name, reference mass kg, max ballast l, three (km/h, m/s) points, wing area m^2, v_no, handicap, empty mass).
// XCSoar marks the entry as taken from SeeYou (Naviter); it is a three-point fit of the manufacturer's polar, not a
// flight test of ours. Water ballast here is capped at the entry's 200 l (200 kg).

export const RHO0 = 1.225, G0 = 9.81;
export const ASW28 = {
  name: 'ASW-28 (15m)',
  source: "XCSoar src/Polar/PolarStore.cpp (master, read 2026-11-28), entry 'ASW-28 (15m)', annotated 'from SeeYou'",
  referenceMass: 310, maxBallast: 200, wingArea: 10.5, emptyMass: 235,
  points: [[92.6, 0.571], [120.38, 0.875], [148.16, 1.394]],      // km/h, sink m/s (positive down)
};

/** Steady glide at airspeed V (m/s) for a drag polar: returns { sink, gamma, CL, LD } with the exact glide angle. */
export function steadyGlide(V, mass, S, CD0, k, rho = RHO0) {
  const W = mass * G0, q = 0.5 * rho * V * V * S;
  let gam = 0, CL = 0, CD = 0;
  for (let it = 0; it < 50; it++) {
    CL = (W * Math.cos(gam)) / (q);
    CD = CD0 + k * CL * CL;
    const g2 = Math.atan(CD / CL);
    if (Math.abs(g2 - gam) < 1e-15) { gam = g2; break; }
    gam = g2;
  }
  return { sink: V * Math.sin(gam), gamma: gam, CL, CD, LD: CL / CD };
}

/** Least-squares fit of (CD0, k) to the published points (Gauss-Newton on the exact glide). */
export function fitPolar(P = ASW28, opts = {}) {
  const S = P.wingArea, m = P.referenceMass;
  const pts = P.points.map(([kmh, w]) => [kmh / 3.6, w]);
  // start from the small-angle linear least squares: w = CD0 rho V^3 S/(2W) + k 2W/(rho V S)
  const W = m * G0;
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const [V, w] of pts) {
    const x1 = (RHO0 * V ** 3 * S) / (2 * W), x2 = opts.parasiticOnly ? 0 : (2 * W) / (RHO0 * V * S);
    a11 += x1 * x1; a12 += x1 * x2; a22 += x2 * x2; b1 += x1 * w; b2 += x2 * w;
  }
  let CD0, k;
  if (opts.parasiticOnly) { CD0 = b1 / a11; k = 0; }
  else { const det = a11 * a22 - a12 * a12; CD0 = (b1 * a22 - b2 * a12) / det; k = (a11 * b2 - a12 * b1) / det; }
  for (let it = 0; it < 30 && !opts.parasiticOnly; it++) {
    let j11 = 0, j12 = 0, j22 = 0, r1 = 0, r2 = 0;
    for (const [V, w] of pts) {
      const f = steadyGlide(V, m, S, CD0, k).sink;
      const d0 = (steadyGlide(V, m, S, CD0 + 1e-7, k).sink - f) / 1e-7;
      const dk = (steadyGlide(V, m, S, CD0, k + 1e-7).sink - f) / 1e-7;
      const r = w - f;
      j11 += d0 * d0; j12 += d0 * dk; j22 += dk * dk; r1 += d0 * r; r2 += dk * r;
    }
    const det = j11 * j22 - j12 * j12;
    const s0 = (r1 * j22 - r2 * j12) / det, sk = (j11 * r2 - j12 * r1) / det;
    CD0 += s0; k += sk;
    if (Math.abs(s0) < 1e-13 && Math.abs(sk) < 1e-13) break;
  }
  const residuals = pts.map(([V, w]) => steadyGlide(V, m, S, CD0, k).sink - w);
  return { CD0, k, residuals, maxAbs: Math.max(...residuals.map(Math.abs)) };
}

export const FIT = fitPolar();

/** The model's sink (m/s, positive down) at airspeed V (m/s) and mass m. */
export const modelSink = (V, mass, P = ASW28, fit = FIT) => steadyGlide(V, mass, P.wingArea, fit.CD0, fit.k).sink;

/**
 * MacCready speed to fly (m/s): the airspeed that minimises the time per metre along track,
 * (sink(V) - w + MC) / (V cos(gamma) + tailwind), over 60..250 km/h at 0.5 km/h.
 */
export function speedToFly(mass, w, MC, tailwind = 0) {
  let free = 0, best = -1, bestV = 25;
  for (let kmh = 60; kmh <= 250; kmh += 0.5) {
    const V = kmh / 3.6, s = modelSink(V, mass);
    const gs = Math.sqrt(Math.max(0, V * V - s * s)) + tailwind;
    if (gs <= 0) continue;
    const d = s - w + MC;
    if (d <= 0) { free = V; continue; }          // the air pays for MC already: the fastest such speed
    const score = gs / d;                        // metres along track per metre of climb at MC
    if (score > best) { best = score; bestV = V; }
  }
  return free > 0 ? free : bestV;
}
