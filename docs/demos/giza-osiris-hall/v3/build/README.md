# Rebuilding the Giza Evidence Atlas

Ordinary exploration uses the generated files already supplied. From the project root, start `python3 serve.py` and open **http://127.0.0.1:8800/**. Windows can use `run.bat` or `py -3 serve.py`; WSL, Linux and macOS can use `bash run.sh`.

## Scene rebuild from bundled bakes

From the project root:

```bash
python3 build/build_scene2.py rebuilt
```

This uses Python 3's standard library, `geo.py`, `x3dlib.py`, the catalogue copy in this folder and the three bundled `light_*.json` files. It writes `giza-atlas-v3.x3d`, `states.bin`, `states.json`, `tour.json`, `const.json` and `clusters.json` to `rebuilt/`. It does not rerun Blender or contact a catalogue service.

The output directory is a set of generated assets, not a complete standalone application. To explore a change, make a separate copy of the complete study and replace those six generated files in that copy. Keep the matching page, catalogue, renderer and metadata beside them. When changing view definitions or content, reconcile `evidence-index.json` and its recorded input hashes as part of the change.

The regression checks run from the project root:

```bash
node --test tests/*.js
python3 -m unittest discover -s tests
```

Node is needed only for JavaScript checks. The scene checks cover structural XML, expected control nodes, finite geometry and the existing baked-colour contract. `scene-structure.json` is their recorded result for the shipped scene. Structural checks do not replace an XSD gate or browser observation.

## Optional generation workflows

| Workflow | Script and inputs | Requirements and outputs |
| --- | --- | --- |
| New light bake | From this folder, `bake.py STATE az el r g b sun sky [samples]` | Blender's Python environment with `bpy`, `bmesh` and `mathutils`; the supplied bakes record Blender 5.2.2, CPU Cycles and 192 samples. Writes `light_STATE.json` in the working directory. |
| Catalogue generation | From this folder, `stars_build.py`; set `STARS_JSON` to the x3d-blender-io `docs/brag/stars.json` input | `numpy`, `astropy`, `pyerfa`; Sesame name resolution needs network access. Writes `stars_v2.json` in the working directory. Reconcile the root catalogue copy deliberately if rebuilding it. |
| Full schema/semantic gate | `X3D_MCP_SRC=/path/to/x3d_mcp/src python3 build/gate.py rebuilt/giza-atlas-v3.x3d` from the project root | External `x3d_mcp` validator and its dependencies, including `lxml`. Prints results; the supplied `validation.json` remains the historical baseline receipt. |
| Historical content assembly | `local_content.py OUT.json [KHUFU_ROWS.json]`, then `merge_content.py JOURNAL.jsonl LOCAL.json OUT_DIR [--log RESEARCH_LOG.md]` | The original research journal and any supplementary row input. Those research inputs are separate from the shipped scene-rebuild inputs. |
| Historical notice generation | `notice.py V2_DIR` | Original-v2 utility retained for provenance. Its template describes the baseline edition; the enhanced `NOTICE.md` and exact `BASELINE-NOTICE-v2.md` are maintained separately. |

## Contracts worth preserving

- Baked mesh order, per-mesh vertex counts, four-state order and buffer length must agree between `states.json`, `states.bin` and the scene's `K_*` colour nodes. Added inspection and Hall detail geometry is outside that unchanged baked mesh layout.
- Metres and the right-handed East/Up/South frame apply throughout. The flat ground datum is a modelling convention.
- `SW_DOC`, `SW_THE` and `SW_SPE` remain independent; `SW_SURVEY`, `SW_SCALE` and `CLIP_SECTION` are stable page controls. The clipping half-space is `Z <= zcut`, with survey and depth annotations outside its scope.
- The original camera-to-`SkyRig` translation ROUTE is preserved. The enhanced sky mathematics is in root `sky-math.js`, rather than regenerated catalogue coordinates.
- `BASELINE-NOTICE-v2.md`, the baseline XSD receipt and the source-card opened/read history keep their original scope. Read `../VALIDATION.md` for checks performed on the enhanced edition.
