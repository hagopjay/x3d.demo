# Demo 83 v2: what changed since v1 (26 Nov 2026)

v1 shipped the world as delivered. x3d_mcp at current main (5543a7b) found 35 warnings in it that the build-time commit (4d433af) could not see. v2 clears them and re-runs every check. The USD and GLB comparison of what each format keeps is unchanged and stays in [`../v1/FORMATS.md`](../v1/FORMATS.md): the cleanup touches rotation axes and degenerate faces only, and `formats/census2.json` shows the same node, camera, light and animation counts.

## What was changed (C: `build/make_v2.py`, `assets/v2-changes.json`)

| fault in v1 | v2 | how |
|---|---|---|
| 4 OrientationInterpolators with non-unit axes (`Orbital_rot` 1.02, `PhiCore_rot` 1.41, `Band_rot`, `Bloom_rot` 1.02) | all axes unit length, same direction, same angle | normalised in the keyValues; `source/gen.py` `spin()` now normalises too |
| 31 IndexedFaceSets with zero-area faces (first: glyph meshes `GB112`, `GB97`, `GR101`) | 0 | 63 faces dropped from 31 meshes; 56 points left unused by them removed where the mesh has no per-vertex colour or normal arrays |

The tolerance is the validator's own (`usd_checks.check_zero_area_faces`: area at most 1e-12 times the squared bounding diagonal, three or more distinct indices). The glyph library filter in x3d.loom `kit/x3d-glyphs` (PR 222) is the same idea for a rebuild.

## Before and after, same file lineage (C)

| check | v1 | v2 |
|---|---|---|
| XSD 4.0 (x3d_mcp 5543a7b) | valid | valid |
| semantic findings, current main | 311 (35 warnings above the baseline) | 275: 258 info unused-def, 1 warning empty-group (by design), 10 transparent-open-mesh, 3 co-located, 3 unused point |
| x3d_mcp 4d433af baseline on v1 | 259 | not re-run |
| Omniverse + usd-core (70 rules, Blender USD) | 64 pass, 6 fail | **65 pass, 5 fail**: ZeroAreaFaceChecker passes now |
| SimReady 1.23.0 (203 codes) | 164 pass, 37 fail, 2 not run | 165 pass, 36 fail, 2 not run |
| glTF-Validator 2.0.0-dev.3.10 | 0 errors, 0 warnings, 667 infos | the same |

Reading (L): the X3D check and the independent USD checker pointed at the same fault, and fixing it in the X3D cleared both. Not matched face by face.

Rig as in v1: Blender 5.3.0 with x3d-blender-io 8adf7c0 (main has since moved), usd-core 26.11, Omniverse Asset Validator 1.18.0, usd-validation-nvidia 1.23.0 with the SimReady tiers at c3bd1d8, x3d_mcp 5543a7b. Files for v2: project files `landscape-v2.x3d`, `landscape-v2-z.usdc`, `landscape-v2.glb`.

Not done: a rebuild from the generator (its fonts were not used; the world is v1's file with a scripted edit, so `source/gen.py` and the shipped world agree on the axes but not byte for byte on the glyph faces); no real GPU.
