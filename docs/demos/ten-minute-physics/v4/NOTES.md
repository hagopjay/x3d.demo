# Batch 4 notes (13 Nov 2026)

* **The witness failed my first double-pendulum run.** MuJoCo disagreed with my "exact" Lagrangian reference by 2.1 m and the reference's energy drifted 7.7: a typo (the denominator 2 - cos 2d should be 3 - cos 2d for two equal masses). The limits were declared before the run and were not changed; the reference was fixed. After the fix MuJoCo and the reference agree to 1.3e-07 m for 3 s, and the reference conserves energy to 8.9e-09.
* **The semantic check caught an invalid scene.** My first smoke scene routed a ColorInterpolator (SFColor out) into a Color node (MFColor in); the XSD accepts that, the fork's semantic check does not. X3D has no interpolator for a whole colour array, so the smoke is now 2,416 dye points whose positions are animated by a CoordinateInterpolator. All scenes in v1 to v4 now also pass the semantic check (0 errors, 0 warnings).
* The XSD alone is not enough for a scene with ROUTEs; run both.
