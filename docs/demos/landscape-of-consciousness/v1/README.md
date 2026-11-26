# Demo 83 · A Landscape of Consciousness in X3D (landscape-of-consciousness/v1)

Robert Lawrence Kuhn's taxonomy (figure by Alex Gomez-Marin) as one X3D 4.0 world: 10 families, 209 entries, 13 viewpoints + 1 OrthoViewpoint, 200 ROUTEs, 209 PROTO instances, a Script-driven tesseract, two GLSL shaders, a ParticleSystem and a Penrose tribar that closes from one standpoint. Labels are glyph geometry (118 glyph meshes, 2,363 uses), so they draw without any font fetch.
Origin: the 25 Nov build (`source/`: gen.py, glyphs.py, validate.py, style lint) delivered with LEARNINGS-landscape-of-consciousness (folded into x3d.loom PR 222, failure modes 407 to 414).
Page: X_ITE 16.7.1 (vendored in Demo 56). It loads the world under a time budget, guards its one field callback, asserts the canvas is not 0 x 0, and runs a SAI twin for the Script when a motion witness finds the Script silent (a no-eval host).
Formats: `FORMATS.md` (USD and GLB from Blender 5.3 against the X3D; rulebooks; validator before and after). Sources and takedown: `DATA-ATTRIBUTION.md`.

| check | result | instrument |
|---|---|---|
| validity | XSD 4.0 valid at x3d_mcp 4d433af and 5543a7b; semantic 259 then 311 findings | x3d_mcp, `formats/val-*.json` |
| page | 13 frames, 0 console lines, 0 HTTP errors, canvas 1028 x 642 | X_ITE 16.7.1, Chromium 158.0.8127.36, SwiftShader (software), `shots/shots-receipt.json` |
| Script | ran in an open page; blocked under a no-eval CSP with the twin moving the points | same rig |

Rebuild the stats: `python3 build/stats.py . build/extra.json`. Run the page check: `node build/shots.mjs <docs root> <out dir>` (needs playwright). Holes: no real GPU, the figure is transcribed by one reader, no second reading of the entries.
