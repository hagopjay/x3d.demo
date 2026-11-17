# Giza Below the Surface Evidence Atlas

An enhanced local X3D study of the Osiris Shaft, Giza's surface monuments, the imagined Hall of Records and the precession sky. It combines visual exploration with measurement, section controls, evidence labels and reproducible settings.

The key distinction is between **the subject's evidence tier, the geometry's modelling status, and the source-handling grade**. A documented subject can have schematic geometry. A source marked “Confirmed” in the supplied cards was opened and read; that grade does not by itself confirm every proposition in it.

## Run locally

```bash
python3 serve.py
```

Open **http://127.0.0.1:8800/** (or the address printed if you choose `--port`). On Windows, run `run.bat` or use `py -3 serve.py`. In WSL, Linux or macOS, use `bash run.sh` or the command above. Keep the terminal running while exploring.

The ordinary browser experience uses bundled assets and does not need Blender, a star-catalogue service or browser dependencies installed from npm. The 3D view needs a recent WebGL-capable browser. Serve the folder over HTTP rather than opening `index.html` directly.

Read `GIZA-FIELD-GUIDE.html` for the full technical and practical guide. `NOTICE.md` describes this edition; `BASELINE-NOTICE-v2.md` preserves the uploaded notice exactly. `STUDY-AUDIT.md`, `SKY-MODEL.md` and `VALIDATION.md` explain corrections, model limits and checks actually performed.

## Explore and investigate

- Keep documented, theorized and speculative layers separately selectable, with view-specific geometry status visible during exploration.
- Use the survey overlay for a local datum, compass and metric reference rings.
- Use the section control to inspect the model's north-side half-space without hiding its reference annotations.
- Compare the published shaft-drop sum, the published section-datum label, and the disputed 648 m proposal in the depth theatre.
- Save up to twelve observations in the browser-local camera notebook. Export a session so the camera, layers, sky, appearance, label mode and inspection settings travel with the view.
- Use the Technical, Wonder, Contested and Ledger lenses and their text search to return from a visual object to the source record.

Keyboard shortcuts: **C** controls, **F** focus, **T** guided descent, **1–4** lenses, **Esc** close a source window or leave focus mode. The compact view context remains visible in focus mode.

Copied links encode the supported observation state and require the same installed study. Session exports add a timestamp, frame description and available input hashes. Import checks the scene hash when one is supplied; the other hashes are recorded for comparison. Notebook records and view links restore without that scene-hash comparison. If camera capture is unavailable, restoration uses the named viewpoint; if clipboard access is unavailable, use session export. Navigation mode, tour progress and discovered-card progress are not part of the session state.

## Corrections and preserved invariants

| Topic | Contract in the enhanced study |
| --- | --- |
| Local frame | Metres; +X east, +Y up, +Z south; Sphinx at the origin. The flat Y=0 plane is a model datum. |
| Depth | 9.62 + 13.25 + 7.50 = 30.37 m is the shaft-drop sum. The published 35.45 m section label uses a different reference convention. |
| Catalogue count | The supplied data contain 978 field-star records and 40 named-star records; the original “41 named” label was incorrect. |
| Epoch display | Astronomical year 0 is 1 BCE. Astronomical year −10499 is 10500 BCE. |
| Epoch interpolation | Interpolate normalized rotations between supplied precession samples; do not linearly blend matrix entries or jump to the nearest century. |
| Sidereal time | An orientation parameter expressed in hours, not a civil time or a date-derived dawn calculation. |
| Observer-centred sky | Preserve the existing camera-to-SkyRig translation relationship, avoiding artificial travel parallax from a finite-radius sky shell. |
| Appearance | Three supplied Cycles bakes plus an illustrative blue-toned night state. The source “sunrise” bake has solar elevation +7°. |
| Speculative geometry | Hall dimensions, ornaments and the deep Khafre visualization remain explicitly invented or claim-based; rendering them supplies no archaeological confirmation. |

The sky remains a bounded precession-only model. Proper motion, refraction and a full civil-time apparent-place pipeline are separate future work. The conceptual Orion-to-pyramid overlay is separate from the astronomical sky.

## Rebuild the scene

From the project root:

```bash
python3 build/build_scene2.py rebuilt
```

The supplied raw light outputs let this step rebuild scene and colour outputs without running Blender. Keep generated scene/data files together with matching page and catalogue assets when serving a rebuild.

A fresh lighting bake uses Blender's Python environment and `build/bake.py`. Rebuilding the star catalogue is separate and needs its documented catalogue input plus scientific Python dependencies. The schema/semantic gate in `build/gate.py` requires an external `x3d_mcp` checkout through `X3D_MCP_SRC`.

The original `validation.json` receipt describes the earlier 2,456,501-byte scene. `build/scene-structure.json` records structural checks for the enhanced scene; it is separate from XSD validation. Consult `VALIDATION.md` for current results and the full build workflow in `build/README.md`.

For the added checks, with Node available for JavaScript tests:

```bash
node --test tests/*.js
python3 -m unittest discover -s tests
```

`VALIDATION.md` names the exact commands, results and environment checks run for this edition. A successful unit test is separate from an XSD gate, a real browser render, or a new source-verification pass.

## Lineage

v3 is the Evidence Atlas edition: the v2 study plus the enhancements listed above, delivered by the Evidence Atlas upgrade (a Git patch against the v2 archive, reviewed and merged here as plain files so the patch itself is not needed). v1 and v2 sit beside this folder untouched. See `DEVELOPING.md` for the working loop and `ROADMAP.md` for the backlog.

## Files

| File or folder | Responsibility |
| --- | --- |
| `index.html`, `giza.js`, `atlas.css` | Local browser interface, X_ITE interaction, visual styling and evidence state |
| `giza-core.js` | Baked-state validation, camera and session input contracts |
| `giza-atlas-v3.x3d` | Generated X3D 4.0 scene with stable DEF names and inspection overlays |
| `sky-math.js`, `SKY-MODEL.md` | Pure sky mathematics, input conventions and limits |
| `states.bin`, `states.json` | State-major baked colour buffers, mesh layout and historical bake receipts |
| `stars_v2.json`, `const.json` | Supplied catalogue directions, sampled rotations and constellation indices |
| `evidence-index.json` | View-specific evidence and geometry metadata |
| `content.json`, `research-log.md` | Supplied cards, ledger and historical source-handling record |
| `build/` | Geometry generation, bundled raw bakes and optional rebuild tools |
| `GIZA-FIELD-GUIDE.html` | Technical explanations, source links and six learning experiments |
| `STUDY-AUDIT.md` | Source-grounded corrections and verification scope |
| `NOTICE.md`, `BASELINE-NOTICE-v2.md` | Enhanced-edition notice and exact uploaded historical notice |
| `VALIDATION.md` | Current checks and their limits |
| `DEVELOPING.md`, `ROADMAP.md`, `Makefile`, `scripts/` | Contributor guide, backlog, one-command checks, smoke test, packaging, leak sweep |
| `serve.py`, `run.bat`, `run.sh` | Local HTTP server and launch scripts; default port 8800 |
| `tests/` | Regression checks added for this enhancement |
| `vendor/` | Bundled X_ITE assets and existing licence |

Geometry is CC0 as stated in the original notice. The derived HYG catalogue remains CC BY-SA 4.0, with attribution to David Nash and the original HYG project. Third-party engines retain their included licences. Claims and source texts retain their own authorship.
