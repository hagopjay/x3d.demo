// SPDX-License-Identifier: GPL-3.0-or-later
// node --test docs/demos/blender-giza-numbers/v6/tests/machine.test.mjs
// The sky machine's maths against the build's own tables and the v4 receipts. No browser, no X_ITE.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  separation,
  obliquity,
  equatorTilt,
  eclipticRotation,
  poleJ2000,
  equinoxJ2000,
  greatArc,
  arcRibbon,
  declinationOfDate,
  declinationFromTrail,
  shaftResiduals,
  shaftConsensus,
  poleDistance,
  trailAt,
  walkSquare,
  witnessGroups,
} from "../machine-math.mjs";
import { GIZA_LAT, qrot, skyRotation, altAz, moved, yearLabel } from "../sky-math.mjs";
import { calendarTicks, arcmin, trailColour } from "../machine.mjs";

const here = new URL("..", import.meta.url);
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, here)));
const cel = J("assets/celestial-data.json"),
  survey = J("assets/survey.json"),
  atlas = J("receipts/atlas.json"),
  sky = J("../v4/assets/sky-data.json"),
  v4 = J("../v4/receipts/claims-v4.json");
const near = (a, b, tol, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const RAD = Math.PI / 180;

test("separation is exact at small and large angles", () => {
  near(separation([1, 0, 0], [0, 1, 0]), 90, 1e-12);
  near(separation([1, 0, 0], [-1, 0, 0]), 180, 1e-12);
  near(separation([1, 0, 0], [Math.cos(1e-6 * RAD), Math.sin(1e-6 * RAD), 0]), 1e-6, 1e-12);
});

test("the equator frame puts the pole due north at the latitude of Giza", () => {
  const { alt, az } = altAz(qrot(equatorTilt(), [0, 1, 0]));
  near(alt, GIZA_LAT, 1e-9, "pole altitude");
  near(Math.min(az, 360 - az), 0, 1e-6, "pole azimuth");
});

test("the obliquity table: 23.44° today, near 24° when the pyramid was built", () => {
  near(obliquity(cel.obliquity, 2000), 23.4393, 0.001, "J2000");
  near(obliquity(cel.obliquity, -2559), 23.978, 0.002, "2560 BC");
  assert.ok(obliquity(cel.obliquity, -7000) > 24.1);
});

test("the ecliptic frame: its pole stands one obliquity from the celestial pole, its equinox on the equator", () => {
  for (const year of [-10499, -2559, 2000]) {
    const eps = obliquity(cel.obliquity, year);
    for (const lst of [0, 1.3, 4.7]) {
      const Q = eclipticRotation(lst, eps);
      const pole = qrot(equatorTilt(), [0, 1, 0]);
      near(separation(qrot(Q, [0, 1, 0]), pole), eps, 1e-9, "ecliptic pole");
      near(separation(qrot(Q, [0, 0, 1]), pole), 90, 1e-9, "equinox point");
      // the summer solstice point, 90° of longitude on, stands one obliquity north of the equator
      near(90 - separation(qrot(Q, [1, 0, 0]), pole), eps, 1e-9, "solstice declination");
    }
  }
});

test("the ecliptic frame turns with the same hour as the stars: the equinox point is where the star table puts RA 0", () => {
  for (const year of [-2559, 2000])
    for (const lst of [0.4, 3.1]) {
      const fromStars = qrot(skyRotation(sky.precession, year, lst), equinoxJ2000(sky.precession, year));
      const fromFrame = qrot(eclipticRotation(lst, obliquity(cel.obliquity, year)), [0, 0, 1]);
      near(separation(fromStars, fromFrame), 0, 0.02, `equinox ${year}`);
    }
});

test("the pole's path the build wrote is the page's own precession, read backwards", () => {
  const last = sky.precession.y0 + sky.precession.step * (sky.precession.n - 1);
  assert.ok(cel.trail.y0 + cel.trail.step * (cel.trail.n - 1) > 12000, "the path runs on past the star table, to close the loop");
  for (const year of [-12000, -10499, -2559, 0, 2000, last])
    near(separation(trailAt(cel.trail, year), poleJ2000(sky.precession, year)), 0, 0.02, `pole ${year}`);
  near(separation(trailAt(cel.trail, 2000), [0, 1, 0]), 0, 1e-6, "J2000 pole");
});

test("two roads to a declination agree: the precession matrix and the distance from the pole's path", () => {
  for (const name of ["Thuban", "Kochab", "Alnitak", "Vega"]) {
    const s = cel.stars[name];
    for (const year of [-2559, 2000])
      near(
        declinationFromTrail(cel.trail, year, s.p, s.v),
        declinationOfDate(sky.precession, year, s.p, s.v),
        0.02,
        `${name} ${year}`,
      );
  }
});

test("pole stars: Thuban, Polaris and Vega against the v4 receipt and the textbooks", () => {
  const closest = (name, from, to) => {
    let best = null;
    for (let y = from; y <= to; y++) {
      const s = cel.stars[name],
        d = poleDistance(trailAt(cel.trail, y), s.p, s.v, y);
      if (!best || d < best.d) best = { y, d };
    }
    return best;
  };
  const th = closest("Thuban", -3400, -2200);
  near(th.d, 0.1, 0.03, "Thuban's least distance");
  near(th.y, -2796, 3, "Thuban's closest year"); // v4 receipt: 2796 BC, on a minimum that is flat for years
  const s = cel.stars.Thuban;
  near(poleDistance(trailAt(cel.trail, -2559), s.p, s.v, -2559), 1.34, 0.01, "Thuban in 2560 BC");
  assert.match(v4.claims.find((c) => c.key === "thuban_pole").verdict, /1\.34°/);
  const po = closest("Polaris", 1900, 2300);
  near(po.d, 0.46, 0.03, "Polaris's least distance");
  near(po.y, 2102, 6, "Polaris's closest year");
  const ve = closest("Vega", -12999, -11000);
  assert.ok(ve.d > 3 && ve.d < 4.5, "Vega never comes closer than a few degrees");
});

test("the four shafts: the v4 misses in 2560 BC, and one best year that is not Khufu's", () => {
  const shafts = v4.claims
    .find((c) => c.key === "shaft_stars")
    .shafts.map((s) => ({ key: s.key, star: s.star, angle: s.gantenbrink_deg }));
  const at = shaftResiduals(cel.trail, shafts, cel.stars, -2559);
  const want = { KS: -0.33, KN: -1.14, QS: -0.62, QN: 0.62 };
  for (const r of at.rows) near(r.d, want[r.key], 0.012, r.key);
  near(at.rms, 0.74, 0.01, "RMS in 2560 BC");
  const { best, curve } = shaftConsensus(cel.trail, shafts, cel.stars);
  assert.ok(best.year > -2460 && best.year < -2360, "best year " + best.year);
  assert.ok(best.rms < at.rms && best.rms > 0.2, "even the best year misses by a quarter of a degree");
  assert.equal(curve.length, 401);
});

test("great arcs and ribbons stay on the sphere", () => {
  const a = moved(cel.stars.Alnitak.p, cel.stars.Alnitak.v, -2559),
    b = moved(cel.stars.Thuban.p, cel.stars.Thuban.v, -2559);
  const arc = greatArc(a, b, 64),
    total = separation(a, b);
  assert.equal(arc.length, 65);
  for (let i = 1; i < arc.length; i++) near(separation(arc[i - 1], arc[i]), total / 64, 1e-9);
  const ribbon = arcRibbon(a, b, { n: 64, radius: 9000 });
  assert.equal(ribbon.length, 65 * 2 * 3);
  assert.equal(cel.ruler_points * 2 * 3, ribbon.length);
  for (let i = 0; i < ribbon.length; i += 3) near(Math.hypot(ribbon[i], ribbon[i + 1], ribbon[i + 2]), 9000, 1e-6);
  assert.equal(greatArc(a, a, 4).length, 5);
});

test("Petrie's squares walk shut: the casing to a millimetre, the core to an inch", () => {
  for (const [key, sq] of Object.entries(survey.squares)) {
    const w = walkSquare(sq.lengths, sq.azimuths);
    near(w.closure, sq.closure_in, 0.002, key + " closure");
    near(w.worst, sq.worst_corner_in, 0.002, key + " worst corner");
    near(w.mean, sq.mean_length, 0.001, key + " mean side");
    w.offsets.forEach((o, i) => {
      near(o[0], sq.corner_offsets_in[i][0], 0.002);
      near(o[1], sq.corner_offsets_in[i][1], 0.002);
    });
  }
  const c = survey.squares.casing;
  near(c.mean_length, c.petrie_mean_length, 0.05, "our mean against Petrie's");
  near(c.mean_length_difference, c.petrie_mean_difference, 0.05);
  near(c.mean_azimuth, c.petrie_mean_azimuth, 0.5);
  assert.ok(c.closure_mm < 2 && c.worst_corner_mm < 25);
  // a perfect square closes exactly and has no corner error
  const p = walkSquare({ N: 100, E: 100, S: 100, W: 100 }, { N: 0, E: 0, S: 0, W: 0 });
  near(p.closure, 0, 1e-9);
  near(p.worst, 0, 1e-9);
  // turning the whole square leaves it square
  const t = walkSquare({ N: 100, E: 100, S: 100, W: 100 }, { N: -223, E: -223, S: -223, W: -223 });
  near(t.closure, 0, 1e-9);
  near(t.worst, 0, 1e-9);
});

test("the witness table covers every claim once and its counts are the page's counts", () => {
  const ind = atlas.independence,
    groups = witnessGroups(atlas.claims);
  assert.equal(atlas.claims.length, 63);
  assert.equal(groups.reduce((a, g) => a + g.claims.length, 0), 63);
  assert.ok(atlas.claims.every((c) => Array.isArray(c.roots) && c.roots.length >= 1 && "modern_unit" in c));
  const keys = new Set(ind.roots.map((r) => r.key));
  assert.ok(atlas.claims.every((c) => c.roots.every((r) => keys.has(r) || r === "khufu_base" || r === "cubit")));
  const monument = groups.filter((g) => g.key !== "none" && g.key !== "sky_only");
  assert.equal(monument.length, ind.facts_about_the_monuments);
  assert.equal(groups.find((g) => g.key === "none").claims.length, ind.claims_on_no_measurement);
  assert.equal(groups.find((g) => g.key === "sky_only").claims.length, ind.claims_on_the_sky_alone);
  assert.equal(monument[0].key, ind.largest_root);
  assert.equal(monument[0].claims.length, ind.largest_root_claims);
  assert.equal(atlas.claims.filter((c) => c.modern_unit).length, ind.claims_needing_a_modern_unit);
  assert.equal(atlas.claims.filter((c) => c.number === "Confirmed").length, ind.confirmed_claims);
  for (const r of ind.roots) assert.equal(groups.find((g) => g.key === r.key).claims.length, r.claims);
  assert.match(ind.kind, /editorial/);
  assert.deepEqual(witnessGroups([{ id: "x" }]), [{ key: "unassigned", claims: ["x"] }]);
});

test("calendar ticks land on round calendar years, and there is no year 0", () => {
  const ticks = calendarTicks(3000, 2000, 1000);
  assert.deepEqual(ticks, [[-2999, "3000 BC"], [-1999, "2000 BC"], [-999, "1000 BC"], [1, "AD 1"], [1000, "AD 1000"], [2000, "AD 2000"]]);
  assert.ok(ticks.every(([y]) => y !== 0));
  assert.equal(yearLabel(-2999), "3,000 BC");
  assert.equal(calendarTicks(12000, 0, 6000)[0][1], "12,000 BC");
  assert.equal(arcmin(-223), "3′43″");
  assert.match(trailColour(-2559), /^(#|rgb)/);
});

test("the star positions the machine carries are the catalogue's own", () => {
  const names = new Set(sky.labels.map((l) => l.n));
  for (const [name, s] of Object.entries(cel.stars)) {
    assert.ok(names.has(name), name);
    assert.equal(s.p.length, 3);
    assert.equal(s.v.length, 3);
  }
  assert.match(cel.stars_from, /David Nash, CC BY-SA 4\.0/);
  // Orion's belt end to end: an angle that the centuries barely touch
  const A = cel.stars.Alnitak;
  assert.ok(A, "Alnitak is carried for the ruler");
});
