# Evidence Atlas validation

Checked 16 November 2026. This is a record of engineering checks, not an archaeological certification.

## Automated checks

```sh
node --test tests/test-core.js tests/test-sky.js
python3 -m unittest discover -s tests -p 'test_*.py'
node --check giza.js
node --check giza-core.js
node --check sky-math.js
```

- **30 Node tests pass:** 13 data/session/camera-contract tests and 17 sky-model tests.
- **8 Python scene tests pass:** XML structure and references, finite generated geometry, scoped inspection tools, preserved scene invariants, exact lighting layout, refusal of a corrupted cache, and byte-identical regeneration of all six scene-builder outputs.
- JavaScript syntax checks pass.
- Evidence-index view/card references and its recorded content, tour and baseline-notice hashes checked; guide anchors and local file links inspected.
- Git patch checked and applied to an independent original extraction; every resulting project file compared with the enhanced tree by SHA-256. The patch itself is excluded from its own reconstruction.

The sky tests cover all 152 stored samples and all 151 adjacent midpoints, rotation orthonormality and length preservation, sample-boundary continuity, azimuth/frame conventions, astronomical year labels, geometric horizon crossings, circumpolar/never-rising/grazing cases, invalid inputs and extreme finite vector normalization. These do not establish interpolation accuracy against newly generated ERFA reference values.

## Browser observations

The bundled X_ITE 16.6.0 rendered in native Chromium using software WebGL. The overview, normalized depth theatre, Osiris section and detailed imagined Hall were inspected. Focus mode retained the evidence/geometry context. The camera notebook saved a cutaway observation, moved to the imagined Hall and restored the cutaway camera, evidence layers and section setting. The report displayed camera values and source hashes. Moving the active section plane to Z = −700 m removed the Osiris geometry around Z = −28 m while leaving its annotations visible, consistent with the retained northern half-space.

A separate browser without WebGL exercised the explicit fallback: source-card lenses, search, corrected sky-card note, manual epoch/star probes and diagnostic report remained usable. Unsupported 3D controls are disabled. The 390-pixel responsive frame and source-card modal had no horizontal overflow. The field guide was inspected in the browser.

Software rendering is functional evidence, not a target-hardware performance benchmark. No GPU timing, hardware scaling study, screenshot regression suite or cross-browser certification was performed.

## Identity and scope

Current generated scene:

```text
giza-atlas-v3.x3d
2537124 bytes
SHA-256 59bce411babf21fee685641804565284ccbc984fee417630e52a21b9d69aebb5
```

The structural report records 2,865 XML nodes, 169 unique DEFs, 16 named study views and a 68-second tour. `states.bin` remains the original 510,432-byte, four-state buffer for 42,536 vertices:

```text
SHA-256 98389c543c949e5f29ad391dd1c271e1bfcf2ddff2eb905983313e44c08de028
```

`validation.json` is the supplied original scene's XSD receipt. **The Evidence Atlas upload itself ran no full XSD, semantic or profile validation; v3 added one (next section).** `build/scene-structure.json` explicitly records structural checks and does not replace that external gate. `build/gate.py` documents how to run the external validator when available.

No new excavation, georeferencing survey, proper-motion catalogue, apparent-place pipeline or date-derived solar ephemeris was produced. Published dimensions, schematic locations, disputed proposals and invented decoration retain their distinct status. The source audit rechecked a selected set of sources; it did not reopen every historically marked source link.

## Added for v3 (17 Nov 2026)

Scene renamed `giza-atlas-v3.x3d`; bytes unchanged (SHA-256 `59bce411...9aebb5`, 2,537,124 bytes). Environment: Linux container, Node 22.23, Python 3.13.

- **Full gate, first for this scene:** x3d_mcp validator (local checkout, commit `fa5dccf`) says XSD 4.0 valid, Immersive profile (components Shape 5, Rendering 5, none missing or unknown), 0 semantic errors, 0 warnings, 133 info notes (unused-DEF notices for nodes the page drives through the SAI). Receipt: `validation-v3.json`, tied to the scene SHA-256. `make check` fails if the scene bytes change without a new `make gate`.
- `make check`: 30 Node tests and 8 Python tests pass again after the rename, including byte-identical regeneration of all six scene outputs; evidence-index references and recorded input hashes match.
- `make smoke` (headless Chromium, software WebGL via SwiftShader): 12 of 12 checks pass at 1280 px and 390 px, no page errors, no horizontal scroll, lens keys 1 to 4 open the source window, diagnostic report builds. No timing was taken.
- Still not done: GPU timing, screenshot regression, cross-browser sweep, reopening every source link (see `ROADMAP.md`).
