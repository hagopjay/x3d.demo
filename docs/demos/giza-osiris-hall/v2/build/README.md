# Build folder

Everything that makes the v2 scene, so it can be rebuilt without Blender:

| Step | Script | Needs |
|---|---|---|
| Light | `bake.py STATE az el r g b sun sky [samples]` writes `light_STATE.json` (kept here: `light_sunrise.json`, `light_midday.json`, `light_afternoon.json`) | Blender 5.2 `bpy` |
| Sky | `stars_build.py` writes `stars_v2.json` (set `STARS_JSON` to the x3d-blender-io `docs/brag/stars.json`) | numpy, astropy (network for Sesame), pyerfa |
| Scene | `build_scene2.py OUTDIR` writes the `.x3d`, `states.bin`, `states.json`, `tour.json`, `const.json`, `clusters.json` from `geo.py` and `x3dlib.py` | Python 3 |
| Check | `gate.py FILE.x3d` runs XSD 4.0, semantic rules and the profile check (set `X3D_MCP_SRC` to the validator's `src`) | the x3d_mcp validator |
| Content | `local_content.py` then `merge_content.py` writes `content.json` and `research-log.md` | the research output |
| Notice | `notice.py V2_DIR` writes `NOTICE.md` | Python 3 |
