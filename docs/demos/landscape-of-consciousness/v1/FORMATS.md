# Demo 83: the Landscape world in USD and GLB, before and after (26 Nov 2026)

Question: what survives when this world leaves X3D? The world (`assets/landscape.x3d`, 4,251,290 bytes) was imported into Blender 5.3.0 with the x3d-blender-io add-on (main at `8adf7c0`) and exported to USD (Blender's own Z-up and a Y-up conversion, and a third USD with animation on) and to GLB. Every number below comes from a file or a tool named beside it; grades C Confirmed (re-run here), L Likely, S Suspected.

Rig: bpy 5.3.0 (Python 3.13); usd-core 26.11 and Omniverse Asset Validator 1.18.0 (Python 3.12); usd-validation-nvidia 1.23.0 with the five SimReady tiers from `NVIDIA/simready-foundation` c3bd1d8; Khronos glTF-Validator 2.0.0-dev.3.10; x3d_mcp `4d433af` and `5543a7b`; renders by Cycles on CPU (no GPU). Scripts: `build/export_formats.py`, `build/census.py`, `build/render_formats.py`, `build/val.py`, `build/gltf_validate.js`. Receipts: `formats/`. The USD and GLB files themselves are not committed (7 to 10 MB each); they are in the project files.

## Files

| file | bytes | Blender export time | options |
|---|---|---|---|
| landscape-z.usdc | 7,418,993 | 2.3 s | Blender's orientation, materials, preview surface, lights, cameras (the x3d.lab Foundry's options) |
| landscape-y.usdc | 7,417,263 | 2.1 s | same, converted to Y up |
| landscape-anim.usdc | 10,038,734 | 64.3 s | same plus `export_animation` |
| landscape.glb | 8,634,480 | 90.1 s | cameras, lights and extras on |

## What each format kept (C: counted in the files by `census.py`, `formats/census.json`, `formats/usd-anim.json`)

| X3D feature (count in the source) | USD | GLB |
|---|---|---|
| Geometry (3,114 Shape nodes, 2,363 of them glyph USEs, 603 IndexedFaceSets, 41 IndexedLineSets) | 2,542 Mesh + 40 BasisCurves prims | 667 meshes, shared by instance |
| Cameras (13 Viewpoints + 1 OrthoViewpoint) | **13; the ortho camera is missing**, all perspective | 14; the ortho one stays `orthographic` |
| Lights (12) | 12 (10 sphere, 2 distant) | 12 (KHR_lights_punctual) |
| Position and Orientation interpolators (48) | none in the default export; 46 animated prims with `export_animation` (31 translate, 15 rotate; timecodes 1 to 3361 at 24/s) | 46 animations, 138 TRS channels |
| ColorInterpolators (35, material colours) | lost | lost |
| ROUTEs (200) | lost; 70 reported "not imported" by the add-on, nothing recorded in the USD | lost; the add-on's 112-entry loss list sits in the scene extras (`x3d_import_losses`) |
| Script (tesseract) | lost | lost, listed in the extras |
| ComposedShader (2, GLSL) | lost | lost |
| ParticleSystem (1) | lost | lost |
| Billboard (21, labels face the viewer) | lost: labels stay fixed (they read mirrored from behind in the renders) | lost, same |
| Sensors (11 Touch, 10 Proximity, 10 BooleanTrigger) | lost (logged by the add-on) | lost (logged in extras) |
| Appearance: 102 UnlitMaterial, 98 PhysicalMaterial | 100 Material prims, **75 with no shader** (the glyph inks); 25 UsdPreviewSurface, 22 with emission | 74 materials, 49 `KHR_materials_unlit`, 22 emissive |
| DEF names, PROTO instances (209) | PROTO expanded; DEF kept as `userProperties:x3d_def` on 5,260 prims | PROTO expanded; DEF kept in extras on all 3,405 nodes |

Reading (L): both formats keep what a viewer needs to look at the world (geometry, lights, cameras, keyframed motion) and neither keeps what makes it a program (ROUTEs, Script, shaders, particles, sensors, billboards). GLB is the better carrier here: it kept the ortho camera that makes the Penrose tribar close, kept unlit appearance, and wrote down what it dropped. The default USD export had no animation at all.

## Side by side

`shots/formats-side-by-side.jpg`: X_ITE frame, USD re-imported, GLB re-imported, same camera. Rows: Overview, station 1, station 5, station 10 (ortho). Renders are Cycles 24 samples on CPU at 1030 x 644, so they differ from X_ITE in shading by construction; read them for what is present, not for pixel agreement.
Observed: USD renders grey (75 of 100 Materials without a shader); the GLB keeps the colour; at the Quantum station a flat placeholder appears where the GLSL ground disc is (magenta in the GLB render, black in the USD render; L that it is that disc); the Penrose tribar closes in the GLB's ortho view and the USD has no camera for it.

## The rulebooks (C, `formats/rb.json`, `formats/sr.json`, `formats/gv-report.json`)

| rulebook | result on the exported file |
|---|---|
| usd-core 26.11 + Omniverse Asset Validator 1.18.0 (70 rules) | 64 pass, 6 fail, Z-up and Y-up alike: ManifoldChecker (5 non-manifold vertices, 4 in Y-up), UnusedMeshTopology, Weld (co-located points), ZeroAreaFace, ValidateTopology, IndexedPrimvar |
| SimReady (usd-validation-nvidia 1.23.0, 216 rules, 203 requirement codes) | Z-up 164 pass, 37 fail, 2 not run; Y-up 162, 39, 2. The failures are mostly physics, robotics, asset-packaging and semantic-label requirements that a viewing world does not claim (L); Y-up adds UN.006 and VG.025 |
| Khronos glTF-Validator 2.0.0-dev.3.10 | 0 errors, 0 warnings, 667 infos (all UNUSED_OBJECT) |

The USD topology failures and X3D's own new findings name the same faults: x3d_mcp reports 31 zero-area faces, 4 unused points and 3 co-located point sets; the Omniverse checkers report ZeroAreaFace, UnusedMeshTopology and Weld on the export (C for each side, L that they are the same faces: not matched face by face).

## Before and after for the X3D validator (C, `formats/val-base.json`, `formats/val-main.json`)

Same file, same machine, two commits of x3d_mcp: `4d433af` (the commit the world was delivered against, before the 25 Nov data checks, #31) and `5543a7b` (main today).

| | 4d433af | 5543a7b |
|---|---|---|
| XSD 4.0 | valid, 0 errors | valid, 0 errors |
| semantic findings | 259: 258 info unused-def, 1 warning empty-group | 311 |
| new, warning | none | 31 mesh-zero-area-face, 4 rotation-axis-not-unit |
| new, info | none | 10 transparent-open-mesh, 4 mesh-unused-point, 3 mesh-colocated-points |

The delivering thread's "0 errors, 1 warning" stands at 4d433af; main adds 35 warnings. They are real defects of the generator, not noise: four OrientationInterpolators (`Orbital_rot`, `PhiCore_rot`, `Band_rot`, `Bloom_rot`) use axes of length 1.02 to 1.41 (X3D requires unit axes), and 31 IndexedFaceSets carry triangles that collapse to a line (the first three listed are glyph meshes `GB112`, `GB97`, `GR101`; the recorded list in `formats/val-main.json` is capped at 40 lines). Demo 83 v1 ships the world as delivered. A v2 should normalise the axes in the generator's `spin()` and use the degenerate-triangle filter now in `kit/x3d-glyphs` (x3d.loom PR 222; on regenerated glyphs it took 4 warning meshes to 0 at four decimals, Ubuntu R and B, C), then re-run this table. Not done here: the rebuild needs the generator's fonts and a decision on a v2.

## Import loss as the add-on reported it (C, `formats/import-loss.json`)

112 lines: 32 event nodes not imported (11 TouchSensor, 10 BooleanTrigger, 10 ProximitySensor, 1 Script), 10 TimeSensors whose play-once, disabled or delayed start is not kept, 70 ROUTEs not imported. Not on the add-on's list, found by counting the files: ComposedShader (2), ParticleSystem (1), Billboard (21) and the 35 ColorInterpolators' colour animation vanish without a loss line (C for the absence in the exports; S that the importer, not the exporter, drops them, because the Blender scene was not inspected for them).

## Not done

No real GPU for any render or frame rate. No Omniverse or Unity open of the USD. No glTF round trip back to X3D. Y-up GLB not exported (glTF is Y-up by definition). The side-by-side is a single reader's judgement of three images.
