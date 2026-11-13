# Batch 5 notes (13 Nov 2026)

Ports of the ideas of Ten Minute Physics 15 (cloth self collision), 18 (FLIP water) and 22 (rigid bodies). Own code, no code copied.

## How the limits were set
`LIM` in `witness/tmp5.py` was not changed after the witness run started, but the record cannot prove that (limit and declared_limit are written by the same run; there is no earlier commit), so read it as 'limits in tmp5.py', not as independent pre-registration. Development runs came first and **informed the scale** of some limits, so they are not blind: the slosh period limit (3%) came after a development run showed 0.3% with the push-apart step off and 7% with it on; the rigid limits (0.15 rad, 2% angular momentum) came after a development run of the free body showed 0.04 rad and 0.7%. Every limit has a control that fails by a wide margin (push-apart on: 8.6%; gyroscopic term off: 3.0 rad; frictionless slope: 1.08 relative; cloth collision off: 91 crossings).

## What failed and was kept in the open
* **Friction cone, development.** My first cone limit compared a slip length with a multiplier. The box slid at 3.00 m/s^2 on the 30 degree slope (closed form 2.36) and also slid at mu 0.7. The slope test found it in one run; fixed by comparing multipliers. Now 0.12% off.
* **FLIP, development.** The push-apart step cost 7 to 9% of the slosh period. The density-excess term is a velocity scale: with a gentle value the water collapsed to about a quarter of its depth, with the value used here the level holds to 0.33 cell. The same value did not hold the volume on an 82x50 grid (the water sank 14% of its depth), so **resolution convergence is not shown**.
* **FLIP pressure, development only (Likely).** The projection's hydrostatic gradient was exactly rho g per cell row (0.612 per three rows against 0.613), but the pressure is zero at the top of the highest occupied cell, not at the particle surface, so it reads about one cell high, and the bottom row read 55% high. Not in the witness.
* **Cloth stretch (witness reference, failed once).** With 8 substeps the cloth stretched 23% at impact (limit 10%). Fixed by running 20 substeps, not by moving the limit: peak 6.8%. Stretch by substeps (same cloth): 4 -> 55.2% peak / 18.4% at rest; 8 -> 23.0% / 8.7%; 20 -> 6.8% / 3.8%.
* **Prediction 1 falsified.** Before grid 1 I wrote: no crossings when vmax*h/t <= 0.9, some when >= 2. 2 of 7 classified runs broke it: the safe half held, the unsafe half did not (0.2 spacing with 4 substeps and 0.1 with 16 had displacement above 2 t and no crossing).

| thickness / spacing | substeps | max speed m/s | vmax*h/t | crossings (max of 10 samples) |
|---|---|---|---|---|
| 0.1 | 4 | 7.2 | 4.41 | 11 |
| 0.1 | 8 | 12.5 | 3.85 | 20 |
| 0.1 | 16 | 18.4 | 2.82 | 0 |
| 0.2 | 4 | 7.2 | 2.21 | 0 |
| 0.2 | 8 | 12.5 | 1.92 | 22 |
| 0.2 | 16 | 18.4 | 1.41 | 0 |
| 0.3 | 4 | 7.2 | 1.47 | 0 |
| 0.3 | 8 | 12.5 | 1.28 | 0 |
| 0.3 | 16 | 18.4 | 0.94 | 0 |
| 0.5 | 4 | 7.2 | 0.88 | 0 |
| 0.5 | 8 | 12.5 | 0.77 | 0 |
| 0.5 | 16 | 18.4 | 0.56 | 0 |

* **Prediction 2 falsified too.** Written after seeing grid 1 and run on fresh drops from 2 m: no crossings when vmax*h/t <= 1, at least one crossing somewhere. 1 violation (thickness 0.45 spacing, 5 substeps, displacement 0.72 t, 7 crossings) and 5 runs with crossings. Neither prediction is in the witness (they would fail); no replacement rule is claimed. What I can say (Suspected): thin collision spheres with few substeps tunnel most; the demo setting (0.6 spacing, 20 substeps) had 0 crossings; judge every setting with the geometric crossing count.

| thickness / spacing | substeps | max speed m/s | vmax*h/t | crossings (max of 10 samples) |
|---|---|---|---|---|
| 0.15 | 5 | 6.6 | 2.17 | 2 |
| 0.15 | 10 | 13.9 | 2.28 | 4 |
| 0.15 | 20 | 16.6 | 1.36 | 14 |
| 0.3 | 5 | 6.6 | 1.09 | 2 |
| 0.3 | 10 | 13.9 | 1.14 | 0 |
| 0.3 | 20 | 16.6 | 0.68 | 0 |
| 0.45 | 5 | 6.6 | 0.72 | 7 |
| 0.45 | 10 | 13.9 | 0.76 | 0 |
| 0.45 | 20 | 16.6 | 0.45 | 0 |

## Honest limits of this batch
One machine, one CPython, numpy 2.5.3, MuJoCo 4.0.1; software GL only, no real GPU, no frame rates. One FLIP grid. No box-box contact. The z spread of the FLIP points is decoration (the sim is 2D). Scenes: x3d_mcp fork 13121b6, XSD 4.0 plus semantic check, 0 errors.
