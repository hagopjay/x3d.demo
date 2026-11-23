# Demo 76 · Marble → Atlas → X3D (v1, 23 Nov 2026)

World Labs opened **Atlas** on 12 Nov 2026: the model it says will power future versions of Marble, with a new Developer API (`api.atlas.worldlabs.ai/api/v2`). This demo bridges every Atlas output type into X3D 4.1 with **zero API spend**: the real 10-camera rig from World Labs' Apache-2.0 splat skill looks at a CC0 procedural room, and the bundle is written in the exact shapes Atlas documents.

| Atlas output | X3D | Witness | Result |
|---|---|---|---|
| camera (pose camera-to-world, XYZW, `rub`/`rdf`; pixel intrinsics) | `Viewpoint` + frustum `IndexedLineSet` | X_ITE 16.7.1 label render vs raycast, 10 cameras × 921,600 px | **99.942 %** mean, 99.686 % worst |
| depth EXR (planar z, rows top-down, NaN = none) + confidence | `PointSet`, `GaussianSplats` | unproject vs true hit points, 573,375 points | **max 0.0005 mm** |
| `posedImages2Splats` SPZ | `GaussianSplats` (identity wrapper) | SPZ v2 write/read, 49,478 splats | ≤ 0.122 mm, ≤ 0.94/255 |
| `splats2Mesh` mesh GLB / `colliderBoxes` GLB | `Inline` / `Collision` proxy `Box`es | boxes vs scene truth | 19 boxes, 0.0 m error |
| all 5 worlds | — | x3d_mcp `4d433af` validate_xml, XSD 4.1 | 5/5 valid |

Traps measured (each alone, same 573,375 points): EXR rows bottom-up 2.12 m mean error, pose read as world-to-camera 3.34 m, `rub` pose labelled `rdf` 6.37 m, depth read along the ray 412 mm, pixel corner instead of centre 2.9 mm. Viewpoint mutants in X_ITE: horizontal instead of smaller-side `fieldOfView` 49.0 %, inverted quaternion 15.7 %, `rdf` without Rx(π) 0.0 %.

Renders: Playwright Chromium 157.0.8103.78 headless, ANGLE SwiftShader (Vulkan 1.3), no real GPU.

## Files

- `kit/atlas2x3d.py`: the bridge (numpy; OpenEXR only to read real EXRs). `kit/make_fixture.py`: the zero-spend fixture.
- `build/run_all.py` → `worlds/*.x3d`, `receipts/numbers.json`. `build/camtest.html|mjs` + `build/compare.py` → `receipts/camtest.json`. `build/receipt.py` → `receipts/loom-receipt.json` (loom.receipt/1, verified by `loomkit.receipt.verify`). `build/page-shots.mjs` → `shots/`.
- `data/bundle/`: the Atlas-shaped bundle. Depth EXRs (about 20 MB) are not committed; rerun `make_fixture.py` (deterministic, sha256 in the receipt).

## When a real Atlas call is made

Download the operation (`worldlabs operations download <id> --out scene`) and point the build at it: `operation.json` holds the same `camera` / `depth` records as `data/bundle/posed-frames.json`. Check the frame of the first real SPZ before trusting the identity wrapper (graded L until measured).

Data and licences: [DATA-ATTRIBUTION.md](DATA-ATTRIBUTION.md), with the takedown notice.
