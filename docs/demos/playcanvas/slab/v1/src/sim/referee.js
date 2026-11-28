// SLAB's analytic referees. Each is a closed form the solver is judged against, never fitted to it.

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

/** Weight per unit slope area above the failure plane: W = g * sum(rho_i * h_i), Pa. */
export const overburden = (layers, g = 9.81) => g * layers.reduce((a, l) => a + l.rho * l.h, 0);

/**
 * Strength of the weak layer in simple shear. Davis (1968): a Mohr-Coulomb material with dilatancy psi sheared
 * between rigid plates mobilises tau = c* + sigma tan(phi*), tan(phi*) = cos(psi) sin(phi) / (1 - sin(psi) sin(phi)),
 * c* = c cos(psi) cos(phi) / (1 - sin(psi) sin(phi)). The solver's return map is non-dilatant (psi = 0), so
 * tau = c cos(phi) + sigma sin(phi). The naive form (psi = phi) is tau = c + sigma tan(phi).
 */
export function strength(c, phiDeg, sigma, psiDeg = 0) {
  const sp = Math.sin(rad(phiDeg)), cp = Math.cos(rad(phiDeg)), ss = Math.sin(rad(psiDeg)), cs = Math.cos(rad(psiDeg));
  const k = 1 - ss * sp;
  return (c * cs * cp) / k + sigma * ((cs * sp) / k);
}

/** Release angle (deg) of an infinite slope: the smallest theta where W sin cos > strength(W cos^2). */
export function releaseAngle({ layers, c, phi, psi = 0, g = 9.81 }) {
  const W = overburden(layers, g);
  const f = (th) => W * Math.sin(th) * Math.cos(th) - strength(c, phi, W * Math.cos(th) ** 2, psi);
  let lo = rad(0.01), hi = rad(89);
  if (f(hi) < 0 && f(rad(45)) < 0) {
    // W sin cos peaks at 45 deg; past that look for the root on the steep side too
    let best = null;
    for (let d = 1; d < 89; d += 0.5) if (f(rad(d)) > 0) { best = d; break; }
    if (best == null) return null;
    hi = rad(best);
  } else if (f(rad(45)) > 0) hi = rad(45);
  for (let k = 0; k < 80; k++) { const m = 0.5 * (lo + hi); if (f(m) > 0) hi = m; else lo = m; }
  return deg(hi);
}

/** Uniaxial-strain P-wave speed sqrt((lambda + 2 mu) / rho). */
export const pwave = (E, nu, rho) => Math.sqrt((E * (1 - nu)) / ((1 + nu) * (1 - 2 * nu)) / rho);

/**
 * Skier stability index in the style of Fohn (1987): strength over stress on the weak layer at depth D, the
 * stress being the slab's own shear plus the largest extra shear from a skier modelled as a static line load R
 * (Fohn used R = 780 N/m) on an elastic half-space (Flamant's radial solution), evaluated numerically along the
 * slope. Strength is Davis's psi = 0 form with the slab's normal stress.
 */
export function skierIndex({ layersAbove, D, theta, c, phi, R = 780, g = 9.81 }) {
  const th = rad(theta), W = overburden(layersAbove, g);
  const tauG = W * Math.sin(th) * Math.cos(th);
  const tauF = strength(c, phi, W * Math.cos(th) ** 2);
  // slope frame (s downhill, n into the snow); the load points straight down: (sin th, cos th)
  const ls = Math.sin(th), ln = Math.cos(th);
  let dmax = 0;
  for (let s = -20 * D; s <= 20 * D; s += D / 200) {
    const r = Math.hypot(s, D), es = s / r, en = D / r;
    const cosb = es * ls + en * ln;
    const srr = (-2 * R * cosb) / (Math.PI * r);
    const tau = -srr * es * en; // downslope shear added on the slope-parallel plane
    if (tau > dmax) dmax = tau;
  }
  return { index: tauF / (tauG + dmax), natural: tauF / tauG, tauG, tauF, dTau: dmax };
}
