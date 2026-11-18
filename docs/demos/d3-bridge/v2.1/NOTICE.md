# D3 to X3D Bridge v2.1

A fix release of v2; `../v2/` and `../v1/` are untouched. It addresses three findings from the external-review thread, each reproduced here first (x3d_mcp fa5dccf, lxml 6.1.3).

| # | Finding | Fix | Check |
|---|---|---|---|
| 1 | `tools/validate.py` exited 0 for an invalid scene and for an empty folder, hard-coded the validator commit, and kept only 5 errors | New `tools/validate.py`: XSD plus x3d_mcp `semantic_diagnostics`. It exits 1 on any XSD or semantic error and 2 on an empty or wrong-sized set, and reads the commit (with a dirty flag), the XSD sha256, lxml and libxml2 from the machine. It keeps every error. | Empty folder: exit 2. v2 scenes: exit 1 (15 of 16). v2.1 scenes: exit 0 (16 of 16). |
| 2 | v2 `spacetime.x3d` uses ClipPlane (Rendering level 5) under profile Immersive with no component declared | The emitter (`tools/x3d2.mjs`) now declares `<component name='Rendering' level='5'/>` on every scene | 16 of 16 pass XSD + semantic (`receipt-xsd.json`) |
| 3 | With WebGL disabled the page threw "Couldn't create browser" and left blank panels | The `<x3d-canvas>` is created only when a WebGL context exists. Otherwise each scene shows its recorded frame and a link to the `.x3d` file. | WebGL disabled: 0 console errors, fallback image shown, 16 tiles, 16 matrix rows (`receipt-no-webgl.json`) |

**Semantic warnings left (not errors).** The 64 `empty-group` warnings are the empty `<Group/>` that each decluttered label uses as its "show nothing" LOD level. That is intended, and it is the usual idiom. The rest are `unused-def` notes for Viewpoints, lights and cached Appearances that the page reaches by name.

**Browser run (Confirmed, 18 Nov 2026).** Headless Chromium (Playwright), SwiftShader software GL, X_ITE 16.6.0: 16 of 16 scenes load with 0 console errors. The interaction checks are unchanged from v2: living graph 144 of 144 nodes and 757 edges, chord isolate 1 of 91 then 91 of 91, sankey tour 8 of 8 viewpoints (`receipt-browser.json`). There is still no GPU run.

Everything else is as in `../v2/NOTICE.md`, including the missed relief-tone target.
