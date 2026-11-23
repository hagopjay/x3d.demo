# Demo 77 · Atlas Bridge: X3D ⟷ World Labs Atlas (v1, 23 Nov 2026)

An X3D blockout (boxes, cylinders, one sphere) goes to the World Labs Atlas Developer API as cameras and exact depth. Atlas paints it. Pictures, Gaussian splats, a mesh and collider boxes come back into one X3D 4.1 file that the X3D to three.js bridge draws, with a new `GaussianSplats` node. Every step is measured against the X3D it started from. Real API calls: **8,986 credits** of a 10,000 cap.

Page: `index.html` (live viewer: layers, Viewpoints, walking, collision against the returned boxes).

## Out: X3D to Atlas

| World | Run | Views | Atlas depth scale | Median depth error | Pixels within 5% | Pixels compared |
|---|---|---|---|---|---|---|
| Reading room | Chisel, ring 1 | 12 | 1.0079 | 1.03% | 90.6% | 8,508,413 |
| Reading room | Chisel, ring 2 (ring 1 as context) | 12 | 1.0063 | 1.98% | 85.7% | 8,337,013 |
| King's Chamber | Chisel | 12 | 1.0054 | 0.88% | 95.5% | 8,835,394 |

Cameras returned by Atlas equal the X3D Viewpoints sent: 0 m, 0 degrees, 36 of 36. Bridge depth against an independent analytic ray cast of the same X3D: median 0.02 to 0.19 mm, p99 under 4.1 mm (curved solids are tessellated) — `receipts/prepare-*.json`.

## Back: Atlas to X3D

| World | What came back | Number | Grade |
|---|---|---|---|
| Reading room | Refined splats, 2,000,000 (SPZ v2, 31.6 MB) | centres a median 37.8 mm from an X3D surface; 62.1% within 50 mm, 92.2% within 100 mm | C |
| Reading room | 24 cameras as Viewpoint | 0 m and 0 deg from the Viewpoints sent | C |
| King's Chamber | Draft splats, 524,288 (SPZ v2, 8.2 MB) | centres a median 50.5 mm from an X3D surface; 49.6% within 50 mm, 73.4% within 100 mm | C |
| King's Chamber | 12 cameras as Viewpoint | 0 m and 0 deg from the Viewpoints sent | C |
| Reading room | Mesh as IndexedTriangleSet, 172,127 vertices, 300,000 triangles | vertices a median 29.2 mm from an X3D surface; 93.6% within 100 mm | C |
| Reading room | 400 collider boxes as a Collision proxy (all upright: yes) | 99.5% of the X3D surface points the cameras see lie within 50 mm of a box; 3.26% of open-air points are wrongly inside one | C |
| King's Chamber | Mesh as IndexedTriangleSet, 104,588 vertices, 200,000 triangles | vertices a median 43.4 mm from an X3D surface; 80.3% within 100 mm | C |
| King's Chamber | 120 collider boxes as a Collision proxy (all upright: yes) | 89.6% of the X3D surface points the cameras see lie within 50 mm of a box; 0.93% of open-air points are wrongly inside one | C |
| Reading room | The return file | reading-room-atlas.x3d, 3.5 MB, valid X3D 4.1 | C |
| King's Chamber | The return file | kings-chamber-atlas.x3d, 3.4 MB, valid X3D 4.1 | C |
| Reading room | A/B, same 12 pictures: splats built on X3D depth vs on the depth Atlas returned | X3D depth: median 39.8 mm, 86.1% within 100 mm. Atlas depth: median 44.4 mm, 82.2% within 100 mm | C |

Grades: C confirmed by a measurement in `receipts/`, L likely, S suspected.

## The bridge pieces

| Piece | File | What it does |
|---|---|---|
| X3D to Atlas | `kit/x3d2atlas.py` | Viewpoint to pinhole camera (`fieldOfView` is the smaller-side angle), depth to linear EXR (planar z, rows top-down, 0 = nothing), node-name masks, Chisel / generate / splat request bodies, camera paths |
| Ray cast | `kit/x3dcast.py` | exact Box / Cylinder / Sphere ray cast and point-to-surface distance: the independent witness |
| Atlas to X3D | `kit/atlas2x3d.py` | cameras to Viewpoint, SPZ v2/v3 reader, splats to `GaussianSplats`, mesh GLB to `IndexedTriangleSet` + `ImageTexture`, collider GLB (matrix nodes) to `Collision` proxy boxes |
| Guarded client | `kit/atlas_client.py` | ledger written before every paid call, hard cap, idempotency keys, no double pay on a repeated label, signed URLs stripped, overlapping runs merged |
| Bridge node | x3d.loom `x3d.threejs/bridge/src/nodes/GaussianSplats.js` (bundled in `bridge-three.js`) | draws the node with Spark when the page hands it over, as points when not; `MetadataString splatFile` names a dense SPZ |
| Scenes | `kit/scenes.py` | the two blockouts, their Viewpoints and prompts |

Rebuild order (needs `WLT_API_KEY`; the paid steps are refused locally once the ledger reaches the cap): `kit/scenes.py` → `build/render_x3d.mjs` → `build/prepare.py` → `build/run_chisel.py` → `build/analyze_chisel.py` → `build/run_splats.py` → `build/run_mesh.py` → `build/measure_return.py` → `build/import_world.py` → `build/page_data.py` → `build/page-shots.mjs`. `build/run_edit.py` is the node-addressed edit; `prompts/` holds every prompt sent (prompt enhancement was off on every call).

## Ledger

| Call | Task | Credits | State | Seconds |
|---|---|---|---|---|
| chisel:kings-chamber | atlasChisel | 160 | succeeded | 26.4 |
| chisel:reading-room | atlasChisel | 160 | succeeded | 24.1 |
| generate:torii | atlasGenerate | 120 | succeeded | 16.4 |
| splats-draft:reading-room:x3d | posedImages2Splats | 0 | refused |  |
| splats-draft:kings-chamber:x3d | posedImages2Splats | 0 | refused |  |
| splats-draft:torii:atlas | posedImages2Splats | 0 | refused |  |
| splats-draft:reading-room:x3d | posedImages2Splats | 500 | succeeded | 30.0 |
| splats-draft:kings-chamber:x3d | posedImages2Splats | 500 | succeeded | 30.0 |
| splats-draft:torii:atlas | posedImages2Splats | 500 | succeeded | 28.8 |
| chisel:reading-room:ring2 | atlasChisel | 160 | succeeded | 28.9 |
| splats-refined:reading-room:x3d | posedImages2Splats | 5000 | succeeded | 1026.3 |
| style:reading-room:sumi | atlasChisel | 64 | succeeded | 14.2 |
| style:reading-room:ruin | atlasChisel | 64 | succeeded | 8.6 |
| style:reading-room:clay | atlasChisel | 64 | succeeded | 8.1 |
| edit:reading-room:globe | atlasChisel | 64 | succeeded | 9.7 |
| chisel:kings-chamber:granite | atlasChisel | 128 | succeeded | 14.7 |
| mesh:kings-chamber:draft | splats2Mesh | 500 | succeeded | 65.1 |
| mesh:reading-room:refined | splats2Mesh | 500 | succeeded | 57.6 |
| splats-draft:reading-room:atlas | posedImages2Splats | 500 | succeeded | 101.3 |

Plus 2 credits for the first posed-photo call made before this demo. Three calls were refused by the API (a draft with `enhancePrompt: false` needs a prompt) and cost nothing.

## Tested / not tested

Tested: every number above (receipts), all return worlds against the X3D 4.1 XSD (x3d_mcp `4d433af`), the page in headless Chromium 157 with software GL (`shots/live-*.png`, `shots/live-*.json`), the bridge's own tooling tests (14 of 14) with the new node in place.

Not tested: any real GPU (frame rate unknown; the refined world is 2,000,000 splats and 32 MB, so the page opens on the smaller King's Chamber), X_ITE on the return worlds, spherical harmonics above degree 0, touch walking controls. The torii leg stops at eight generated views; they disagree in places and were not meshed.

Rig for every render: Playwright Chromium 157.0.8103.78 headless, ANGLE SwiftShader, three r187, Spark 2.4.0.

Data, licences and the takedown notice: [DATA-ATTRIBUTION.md](DATA-ATTRIBUTION.md). Atlas outputs here are World Labs material shown with credit for personal, non-commercial use.
