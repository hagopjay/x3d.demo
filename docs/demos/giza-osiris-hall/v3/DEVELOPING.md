# Developing the Giza Evidence Atlas (v3)

Everything runs offline from this folder. Python 3 and Node 20+ are enough; Blender, Playwright and the `x3d_mcp` validator are optional and named where used. Numbers below were measured on 17 Nov 2026 in a Linux container (Node 22, Python 3.13, headless Chromium with software WebGL), so they say "works", not "fast".

## The loop

```bash
make serve     # http://127.0.0.1:8800/  (no-cache headers, no write endpoints)
make check     # JS + Python syntax, JSON, 30 Node + 8 Python tests, cross-refs, scene identity (about 3 s)
make gate      # XSD + semantic + profile through x3d_mcp: X3D_MCP_SRC=/path/to/x3d_mcp/src make gate
make smoke     # headless browser: boots, lens keys 1-4, report, 390 px and 1280 px overflow, no page errors
make rebuild   # regenerate the six scene outputs from the bundled Cycles bakes into ./rebuilt (no Blender)
make package   # dist/giza-atlas-v3.zip
make sweep     # leak sweep before anything is published
```

`make check` is what CI runs (`.github/workflows/giza-v3.yml` at the repo root). `make gate` and `make smoke` are separate because they need an external checkout or a browser.

## Map of the code

| Layer | Files | Owns |
| --- | --- | --- |
| Page | `index.html`, `atlas.css` | Markup, control dock, glass modals, responsive layout |
| Runtime | `giza.js` (UI, X_ITE SAI, lenses, notebook, session import and export) | Everything that touches the DOM or the scene graph. Exposes `window.__giza` (`state`, `go`, `captureState`, `restoreState`, `report`) |
| Pure logic | `giza-core.js` (baked-state decode, camera and session contracts), `sky-math.js` (precession, rotation interpolation, horizon maths) | No DOM, fully unit-tested under Node. Put new maths here, not in `giza.js` |
| Scene | `giza-atlas-v3.x3d` + `states.bin`, `states.json`, `tour.json`, `const.json`, `clusters.json` | **Generated** by `build/build_scene2.py`. Never hand-edit; change the builder |
| Data | `content.json` (75 cards, ledger), `evidence-index.json` (per-view tier, geometry status, limits), `stars_v2.json` | Claims and provenance |
| Build | `build/` (`geo.py`, `x3dlib.py`, `build_scene2.py`, `bake.py`, `light_*.json`, `gate.py`) | See `build/README.md` |
| Checks | `tests/`, `scripts/` | Regression and tooling |

## Contracts that break silently if you ignore them

1. **Baked colour layout.** `states.json`, `states.bin` and the scene's `K_*` colour nodes must agree on mesh order, per-mesh vertex counts, the four states and total length (510,432 bytes, 42,536 vertices). Added geometry must live outside the baked meshes. `tests/` refuses a mismatch.
2. **Frame.** Metres, +X east, +Y up, +Z south, Sphinx at the origin. Y = 0 is a model datum.
3. **Stable DEF names.** `SW_DOC`, `SW_THE`, `SW_SPE` (independent evidence layers), `SW_SURVEY`, `SW_SCALE`, `CLIP_SECTION`, `SkyRig` and the 16 `V_*` viewpoints are used by the page. `scripts/check_refs.py` checks them.
4. **Sky.** Interpolate rotations (shortest-arc quaternions), never matrix entries; keep the camera-to-`SkyRig` translation ROUTE; epochs are astronomical years (year 0 = 1 BCE; -10499 = 10500 BCE). `SKY-MODEL.md` lists what is not modelled.
5. **Three separate grades.** Evidence tier of the subject (documented, theorized, speculative), geometry status (schematic, claim-based, invented), and source handling (opened and read, or not). Do not merge them in UI copy.
6. **Receipts are tied to bytes.** `validation-v3.json` records the scene SHA-256; `make check` fails if the scene changes without a new `make gate`. `validation.json` and `BASELINE-NOTICE-v2.md` are the frozen v2 baseline: do not edit them.

## Recipes

**Change geometry or a viewpoint.** Edit `build/geo.py` or `build/build_scene2.py`, run `make rebuild`, compare the new files in `rebuilt/` with the root copies, copy all six generated files together, then `make check && make gate`. Update `scene-structure.json` expectations in `tests/test_scene.py` only on purpose.

**Add or edit a card.** Edit `content.json` (cards carry lens, claim, evidence, grade, links). Re-run `make check`; refresh the `content_sha256` in `evidence-index.json` in the same commit. Never mark a source "opened" unless someone opened it; add the row to `research-log.md`.

**Add a lighting state.** Bake with `build/bake.py` in Blender (documented in `build/README.md`), add `light_NAME.json`, extend the state list in the builder, `giza-core.js` validation and its tests together. The four-state count is asserted on purpose.

**Add a sky feature.** Add pure functions to `sky-math.js` with tests in `tests/test-sky.js` first; wire the UI in `giza.js` after.

**Use the debug hook.** In the console: `await __giza.report()` for the diagnostic report, `__giza.go('V_Osiris')` to fly to a view, `__giza.captureState()` for the session object.

## Release hygiene

1. `make check`, `X3D_MCP_SRC=... make gate`, `make smoke`, `make sweep`.
2. New version = new folder (`../v4/`). Never overwrite v1, v2 or an earlier v3 release.
3. Add a dated CHANGELOG entry in the repo root; credits and licences stay in `NOTICE.md` (HYG star data is CC BY-SA 4.0, so `stars_v2.json` is a derived work under the same licence).
4. Front-page cards and numbering belong to the site owner, not to this folder.

## Known limits (do not claim past these)

Software WebGL only so far: no GPU timing, no screenshot regression, no cross-browser sweep. No proper motion, refraction or civil-time apparent place in the sky. Only 125 of 128 source links were opened by the research pass; none was reopened wholesale for v3. The Hall, Khafre cubes and ornaments are speculative drawings, not findings.
