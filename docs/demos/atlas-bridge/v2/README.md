# Atlas Bridge v2: Blender in the loop

v1 (Demo 77, `../v1/`) sent an X3D blockout of boxes to World Labs Atlas and brought the result home as X3D. v2 puts Blender on both ends. One scene, a scriptorium modelled in Blender 5.3, goes out through the Blenderizer add-on as X3D with Cycles depth, and Blender then does four more jobs on what Atlas returns.

| # | Blender's role | Script | Receipt | Headline (all Confirmed by measurement) |
|---|---|---|---|---|
| 1 | Build the input: scene, cameras, Cycles depth | `blender/make_scene.py`, `add_ring2.py`, `export_and_render.py`, `compare_depth.py` | `prepare-scriptorium24.json`, `scriptorium-chisel-scriptorium.json` | camera 0.0007 mm / 0.012 deg; Cycles vs X3D depth median 0.09 mm; Atlas depth back within 0.73% |
| 2 | Clean the result: bake Atlas pictures onto exact geometry, export clean X3D | `blender/bake_atlas_views.py`, `build/score_clean.py` | `scriptorium-clean24.json` | valid X3D 4.0, one 4096 texture, 448 m2 painted, 22.9 dB vs the Atlas pictures |
| 3 | Match colour between rings with one compositor node | `blender/match_exposure.py` | `*-ring2-colour-match.json` | node equals the fit to 1/255; the v1 gap is content disagreement, not exposure (13.1 to 14.1 dB after match; ring 1 against itself 12.4 dB) |
| 4 | Judge: Cycles object-index and beauty passes as reference | `blender/cycles_judge.py` | `scriptorium-cycles-judge.json` | Atlas keeps 84.1% of object outlines; hue median 8.2 deg off |
| 5 | Test colliders with rigid bodies | `blender/physics_colliders.py` | `physics-scriptorium.json`, `physics-reading-room.json` | median rest height 47.5 mm off; 61 of 323 probes land 100 mm+ high |

Rig behind every number: Blender 5.3.0 `bpy` wheel on Python 3.13, Cycles CPU; X3D Blender I/O add-on v2.7.4 (x3d-blender-io `0eb4809`); X3D to three.js bridge on three r187 in headless Chromium 157 with SwiftShader; validator hagopjay/x3d_mcp `4d433af`.

## Things that were not done, or did not work
- The Atlas mesh was measured (median 24 mm from the Blender surface) but not repaired. Role 2 goes around it: paint on known geometry beats fixing generated geometry.
- No refined splat (5,000 credits) was bought for this scene; all splats here are the 500-credit draft.
- 1,741 of 4,086 faces are seen by no Atlas view (outsides of walls, hidden faces, undersides); they keep their flat Blender colour. Book edges show ghosting where two views disagree.
- Role 3 did not close the v1 gap. The measurement says there was little exposure gap to close.
- Blender notes: the Cycles Depth pass is planar z (measured); Blender 5 needs `image_settings.media_type = "MULTI_LAYER_IMAGE"` before the multilayer EXR format; a Boolean cut removed a whole wall, so the windows are built from quads; the UV island packer stalls on 374 objects, while `smart_project` in multi-object edit mode already packs across objects; the compositor needs `render.compositor_device = "CPU"` without a GPU.

## Run
```
python blender/make_scene.py worlds/scriptorium.blend
python blender/add_ring2.py worlds/scriptorium.blend worlds/scriptorium24.blend
python blender/export_and_render.py worlds/scriptorium24.blend <x3d-blender-io> out/cycles24
node build/render_x3d.mjs worlds/scriptorium24.x3d out/bridge && python blender/compare_depth.py scriptorium24 cycles24
python build/run_chisel.py scriptorium24 ...        # paid: needs WLT_API_KEY and a ledger cap
python blender/bake_atlas_views.py worlds/scriptorium24.blend <ring1>,<ring2> out/scriptorium24 <x3d-blender-io> worlds/scriptorium-clean24
python blender/match_exposure.py <ring1> <ring2> out/scriptorium24 out/match receipts/scriptorium-ring2-colour-match.json
python blender/physics_colliders.py worlds/scriptorium.x3d worlds/scriptorium-atlas.x3d <x3d-blender-io> receipts/physics-scriptorium.json
python build/page_data.py && node build/page-shots.mjs
```
Rights and takedown: see `DATA-ATTRIBUTION.md`.
