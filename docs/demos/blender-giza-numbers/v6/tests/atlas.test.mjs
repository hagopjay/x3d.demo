// SPDX-License-Identifier: GPL-3.0-or-later
// node --test docs/demos/blender-giza-numbers/v6/tests/atlas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fmt, markDigits, filterClaims, literalDigits, NUMBER_GRADES, DESIGN_GRADES } from "../atlas-math.mjs";
import {
  GIZA_LAT, qmul, qconj, qrot, qaxis, qslerp, qToAxisAngle, axisAngleToQ, lookAt, precessionQ, skyRotation, raDecOfDate, altAz,
  moved, culminationAltitude, project, yearLabel,
} from "../sky-math.mjs";

const here = new URL("..", import.meta.url);
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, here)));
const atlas = J("receipts/atlas.json"), v4 = J("../v4/receipts/claims-v4.json"), sky = J("../v4/assets/sky-data.json"), stage = J("../v4/assets/stage-data.json");
const x3d = fs.readFileSync(new URL("../v4/assets/sky.x3d", here), "utf8");
const field = (def, name) => x3d.match(new RegExp(`DEF='${def}'[^>]*?\\b${name}='([^']*)'`))[1].trim().split(/\s+/).map(Number);
const bright = field("StarsBright", "positions"), faint = field("StarsFaint", "positions");
const star = (i) => (i < sky.bright ? bright.slice(3 * i, 3 * i + 3) : faint.slice(3 * (i - sky.bright), 3 * (i - sky.bright) + 3));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b}`);

test("the atlas holds 60+ claims, each with both grades, a source and a proof stop that exists", () => {
  assert.ok(atlas.count >= 60 && atlas.claims.length === atlas.count);
  const ids = new Set();
  for (const c of atlas.claims) {
    assert.ok(!ids.has(c.id), c.id); ids.add(c.id);
    assert.ok(NUMBER_GRADES.includes(c.number), c.id + " number " + c.number);
    assert.ok(DESIGN_GRADES.includes(c.design), c.id + " design " + c.design);
    assert.ok(c.wonder.length > 10 && c.test.length > 4 && c.source.length > 5, c.id);
    assert.ok(stage.stops[c.proof.stop], c.id + " stop " + c.proof.stop);
    assert.ok(c.proof.rig == null || stage.rigs.includes(c.proof.rig), c.id + " rig " + c.proof.rig);
    if (c.measured != null && c.target != null) assert.equal(c.literal, literalDigits(c.measured, c.target), c.id + " literal digits");
  }
  assert.equal(Object.values(atlas.number_grades).reduce((a, b) => a + b), atlas.count);
});

test("literal digits on the cards follow the v3 rule and the marker colours exactly that many digits", () => {
  const hits = (text, k) => markDigits(text, k).filter(([, h]) => h === true).map(([t]) => t).join("").replace(/\D/g, "").length;
  assert.equal(hits(fmt(299.769), 4), 4);
  assert.equal(hits(fmt(0.52375), 3), 3);
  assert.equal(hits("39,806.7", 2), 2);
  assert.equal(literalDigits(1.2727, 14 / 11), 5);
  assert.equal(filterClaims(atlas.claims, { number: new Set(["False"]) }).length, atlas.number_grades.False);
  assert.ok(filterClaims(atlas.claims, { q: "seked" }).length >= 2);
});

test("quaternion helpers: rotation, slerp and the X3D axis-angle round trip", () => {
  const q = qaxis(0, 1, 0, Math.PI / 2);
  const v = qrot(q, [1, 0, 0]);
  near(v[0], 0, 1e-12); near(v[2], -1, 1e-12);
  const r = axisAngleToQ(qToAxisAngle(q));
  for (let i = 0; i < 4; i++) near(r[i], q[i], 1e-12);
  const h = qslerp([0, 0, 0, 1], q, 0.5);
  near(2 * Math.acos(h[3]), Math.PI / 4, 1e-12);
  const id = qmul(q, qconj(q));
  near(id[3], 1, 1e-12);
});

test("lookAt reproduces the generator's viewpoint orientations", () => {
  for (const [name, s] of Object.entries(stage.stops)) {
    const a = qToAxisAngle(lookAt(s.pos, s.at)), fwd = qrot(lookAt(s.pos, s.at), [0, 0, -1]);
    const want = [s.at[0] - s.pos[0], s.at[1] - s.pos[1], s.at[2] - s.pos[2]], n = Math.hypot(...want);
    for (let i = 0; i < 3; i++) near(fwd[i], want[i] / n, 1e-9, name);
    const fq = qrot(axisAngleToQ(s.ori), [0, 0, -1]);
    for (let i = 0; i < 3; i++) near(fq[i], want[i] / n, 1e-4, name + " file orientation");
    assert.ok(a.length === 4);
  }
});

test("the page's sky agrees with the Python receipt: shaft stars in 2560 BC", () => {
  const sh = v4.claims.find((c) => c.key === "shaft_stars").shafts;
  for (const s of sh) {
    const i = sky.key[s.star], m = sky.movers.find((x) => x.i === i);
    const p = m ? moved(star(i), m.v, -2559) : star(i);
    const { dec, ra } = raDecOfDate(sky.precession, -2559, p);
    near(culminationAltitude(dec), s.altitude_2560BC, 0.02, s.star + " culmination");
    // put the star on the meridian: its azimuth must be due south or due north, its altitude the culmination
    const aa = altAz(qrot(skyRotation(sky.precession, -2559, ra, GIZA_LAT), p));
    near(aa.alt, s.altitude_2560BC, 0.02, s.star + " altitude");
    near(Math.min(Math.abs(aa.az - 180), Math.abs(aa.az), Math.abs(aa.az - 360)), 0, 0.01, s.star + " on the meridian");
  }
});

test("the pole of the sky stands at Giza's latitude, and Thuban hugs it in 2560 BC while Polaris does not", () => {
  const R = skyRotation(sky.precession, -2559, 1.234, GIZA_LAT);
  const pole = qrot(qconj(precessionQ(sky.precession, -2559)), [0, 1, 0]);   // the pole of date, in J2000 file axes
  const aa = altAz(qrot(R, pole));
  near(aa.alt, GIZA_LAT, 1e-6);
  const sep = (name) => 90 - raDecOfDate(sky.precession, -2559, star(sky.key[name])).dec;
  assert.ok(sep("Thuban") < 2 && sep("Polaris") > 20, `${sep("Thuban")} ${sep("Polaris")}`);
  const today = 90 - raDecOfDate(sky.precession, 2026, star(sky.key.Polaris)).dec;
  assert.ok(today < 1, String(today));
});

test("the star file matches its receipt: counts, label metadata, licence", () => {
  assert.equal(bright.length / 3, sky.bright + sky.halos);
  assert.equal(faint.length / 3, sky.faint);
  assert.equal(sky.stars, sky.bright + sky.faint);
  assert.ok(sky.stars > 50000 && sky.labels.length > 3000);
  const names = x3d.match(/name='name' value='([^']*)'/)[1].match(/"[^"]*"/g);
  assert.equal(names.length, sky.labels.length);
  assert.ok(/CC BY-SA 4\.0/.test(x3d) && /David Nash/.test(x3d));
  for (const l of sky.labels) assert.ok(l.i >= 0 && l.i < sky.stars);
  for (const [a, b] of sky.lines) assert.ok(a < sky.bright && b < sky.bright);
});

test("projection and year labels", () => {
  assert.deepEqual(project([0, 0, -1], 800, 600, Math.PI / 4), [400, 300]);
  assert.equal(project([0, 0, 1], 800, 600, Math.PI / 4), null);
  const edge = project([0, Math.tan(Math.PI / 8), -1], 800, 600, Math.PI / 4);
  near(edge[1], 0, 1e-9);
  assert.equal(yearLabel(-2559), "2,560 BC");
  assert.equal(yearLabel(0), "1 BC");
  assert.equal(yearLabel(2026), "AD 2026");
});
