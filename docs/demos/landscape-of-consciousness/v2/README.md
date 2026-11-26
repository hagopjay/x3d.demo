# Demo 83 · A Landscape of Consciousness in X3D, version 2 (landscape-of-consciousness/v2)

Same world and page as v1 with the 35 warnings that current x3d_mcp finds cleared: 4 non-unit rotation axes and 31 meshes with zero-area faces (63 faces dropped, 56 orphaned points removed). `FORMATS.md` has the before and after; v1 stays as shipped (`../v1/`).

| check | result | instrument |
|---|---|---|
| validity | XSD 4.0 valid; semantic 275 findings (v1: 311), 0 new warnings | x3d_mcp 5543a7b, `formats/val-v2.json` |
| USD | 65 of 70 rules pass (v1: 64); SimReady 165 pass, 36 fail (v1: 164, 37) | usd-core 26.11, OAV 1.18.0, usd-validation-nvidia 1.23.0 |
| glTF | 0 errors, 0 warnings, 667 infos | glTF-Validator 2.0.0-dev.3.10 |
| page | 13 frames, 0 console lines, 0 HTTP errors, canvas 1028 x 642, Script ran | X_ITE 16.7.1, Chromium 158.0.8127.36, SwiftShader (software), `shots/shots-receipt.json` |

Edit script: `build/make_v2.py v1/assets/landscape.x3d v2/assets/landscape.x3d report.json`. Holes: not rebuilt from the generator (no fonts used); no real GPU.
