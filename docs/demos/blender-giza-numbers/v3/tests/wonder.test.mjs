// SPDX-License-Identifier: GPL-3.0-or-later
// node --test docs/demos/blender-giza-numbers/v3/tests/wonder.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  literalDigits, roundingDigits, chanceOfPrefix, candidates, coincidenceRun, MONUMENTS, TARGETS,
  eclipseSky, lastTotalEclipseYears,
} from "../wonder-math.mjs";

test("literal digits are character agreement, not rounding agreement (review finding P1)", () => {
  assert.equal(literalDigits(1079.5703, 1080), 2);
  assert.equal(roundingDigits(1079.5703, 1080), 4);
  assert.equal(literalDigits(9.99, 10.01), 0);
  assert.equal(literalDigits(29.979175, 29.9792458), 5);
  assert.equal(literalDigits(3.14016, Math.PI), 3);
  assert.equal(literalDigits(0.0031415, Math.PI), 5, "powers of ten are free");
});

test("prefix chance follows the log-uniform mantissa and sums to one over a digit", () => {
  let sum = 0;
  for (let k = 1; k <= 9; k++) sum += chanceOfPrefix(k, 1);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(Math.abs(chanceOfPrefix(Math.PI, 3) - Math.log10(1 + 0.01 / 3.14)) < 1e-12);
});

test("Monte Carlo log-uniform numbers hit targets at the predicted rate", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const N = 200000, d = 3;
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const v = 10 ** (rnd() * 6 - 3);
    if (literalDigits(v, Math.PI) >= d) hits++;
  }
  const expect = N * chanceOfPrefix(Math.PI, d);
  assert.ok(Math.abs(hits - expect) < 4 * Math.sqrt(expect), `${hits} vs ${expect}`);
});

test("definitional ratios of the square are excluded", () => {
  const texts = candidates(MONUMENTS.great).map((c) => c.text);
  assert.ok(!texts.includes("base diagonal ÷ base side"));
  assert.ok(texts.includes("perimeter ÷ twice the height"));
  assert.ok(texts.includes("slant height ÷ half-base"));
});

test("the Great Pyramid's famous matches appear, and freedoms change the count of tries", () => {
  const r3 = coincidenceRun(MONUMENTS.great, 3);
  const keys = r3.hits.map((h) => h.target.key);
  for (const k of ["c", "pi", "tau", "phi"]) assert.ok(keys.includes(k), k);
  const strict = coincidenceRun(MONUMENTS.great, 3, { units: false, inverses: false, site: false });
  assert.ok(strict.tries < r3.tries);
  assert.equal(r3.comparisons, r3.tries * TARGETS.length);
});

test("eclipse sky: totals and annulars both possible today; totals end within a billion years", () => {
  const s = eclipseSky(0);
  assert.ok(s.totalPossible && s.annularPossible);
  const y = lastTotalEclipseYears();
  assert.ok(y > 5e8 && y < 7e8, String(y));
  assert.equal(eclipseSky(y * 1.01).totalPossible, false);
  assert.equal(eclipseSky(y * 0.99).totalPossible, true);
});
