# Errata for v1 (13 Nov 2026)

v1 is left exactly as merged (demos are never overwritten); v3 supersedes the two points below.

## 1. v1 billiards never exchanged momentum (a bug in my port)

The pair rule applied the impulse when the normal speed was *negative*, that is when the balls were already separating, so approaching balls were only pushed apart by the position correction and kept their velocity. The v1 page also said "collisions alone conserve energy to machine precision (1.3e-15)": that was true but empty, because with no impulse applied there is nothing to conserve.

Found by the exact pair reference in the Loom physics witness: a head-on equal-mass elastic pair must exchange velocities; the v1 rule leaves a swap error of **4.0 m/s** (limit 1e-12); the fixed rule gives **0.0**. Momentum and kinetic energy changes are 0.0 and 0.0.
Fixed in `03-billiards-fixed.x3d` (one line: `vn > 0`, see `witness/billiards_fixed.py`). With real collisions the 16-ball frictionless kinetic energy drifts 2.0e-15 (relative, 15 s), and the rack now breaks.

## 2. v1 cannonball: the mechanism was oversimplified

v1 said the order of the two Euler lines decides whether energy is bounded. Measured here (numpy 360 steps at 1/30 s, box with bounces, E0 = 35.3):
* In free flight **both** orders conserve a shadow energy to 9e-13 (symplectic: E - g h v / 2; explicit: E + g h v / 2). The true energy moves by -g^2 h^2 / 2 (symplectic) or +g^2 h^2 / 2 (explicit) every step.
* Reflecting the penetration off a wall adds energy to both: 14.1 (symplectic, 7 bounces) and 14.1 (explicit, 21 bounces) over 12 s.
* For the symplectic ball the per-step loss roughly pays for that toll (net -5.1, final E/E0 0.854); for the explicit ball the drift has the same sign as the toll, so they add (final E/E0 1.94).
* Longer runs (E/E0, h = 1/30): symplectic stays within 0.61 to 1.09 over 300 s; explicit reaches 5.98 at 60 s and 12.86 at 300 s.
Grades: the numbers are Confirmed (witness_tmp.py, numpy 2.5.3); that the loss pays for the toll *on average* is Likely (reasoned: toll per bounce ~ g h |v|, bounce rate ~ g / 2|v|, product ~ g^2 h / 2 per second).

## 3. A determinism finding

`np.linalg.norm` on a 2-vector differs by 1 ulp from scalar `sqrt(x*x + y*y)`: a numpy bead run leaves a pure-Python replay at substep 86 of frame 0 (difference -2.2e-16), so every per-frame hash differed. The witness engine now uses the explicit sqrt and the two hosts agree on all 360 frames. (The v1 scene was built with `np.linalg.norm`; the difference is far below anything visible.)
