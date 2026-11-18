# Giza VI: validation receipts

Every number below names the instrument behind it. Measured 18 Nov 2026 in a Linux cloud container (CPU only, no GPU). Grades: **C** run and read here, **L** computed here or likely, **S** suspected.

## Instruments

| Instrument | Version | Used for |
|---|---|---|
| Node.js | 22.23.5 | `tests/v6.test.mjs`, `build/export_x3d.mjs`, the packs' own Node tests |
| Python | 3.13 | `../v3/build/gate.py` (called by `build/gate.sh`), the packs' Python tests |
| x3d_mcp validator | commit `fa5dccf` (hagopjay/x3d_mcp fork) | XSD, semantic and profile checks of `giza-vi.x3d` |
| Headless Chromium | 157.0.8103.78 (Playwright) | every screenshot and browser number |
| WebGL renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver) | software rasteriser, not a GPU |
| Babylon.js | 8.56.2 (npm) | the page |
| X_ITE | 16.6.0 (`../v3/vendor/x_ite/`) | `twin.html` |

## Vendored files (SHA-256)

| File | SHA-256 |
|---|---|
| `vendor/babylon/babylon.js` | `37c77bf920c0d7a3912c28a6120479f3d08fccd87a75e1f7558f76bd124cc6c4` |
| `vendor/babylon/babylon.skyMaterial.min.js` | `2e4c7aff66ae0f936241b83e5c65183d8a55993098c9d74c41bd41784c5504be` |
| `vendor/babylon/LICENSE.md` | `9362ea9ea17cb221a20cbbd63f404710834cc273d2a9a7b60314fd68ab702cd6` |

## The X3D twin (C)

`giza-vi.x3d` is written by `node build/export_x3d.mjs giza-vi.x3d` from `world.mjs` and checked by `X3D_MCP_SRC=<x3d_mcp>/src bash build/gate.sh`. The receipt is `validation-vi.json`; `tests/v6.test.mjs` rebuilds the file, requires it byte-identical, and requires the receipt's hash to match.

| Field | Value | Instrument |
|---|---|---|
| bytes | 3,394,289 | gate.sh |
| sha256 | `5ddfb099d4da8157ea60bcbd8ad8fc7c53dfd5b9d52d4d99734e1992fcee55c4` | gate.sh |
| X3D version, profile | 4.0, Immersive + Shape component level 5 | x3d_mcp `fa5dccf` |
| XSD | valid, 0 errors | x3d_mcp `fa5dccf` |
| Semantic | 0 errors, 0 warnings (65 info) | x3d_mcp `fa5dccf` |
| Meshes, vertices, triangles, line points | 40, 67,726, 111,850, 2,354 | `world.census()` |
| Meshes by grade | Confirmed 14, Likely 12, Suspected 4, Authored 10 | `world.census()` |
| Viewpoints | 16 (one per shot) | X_ITE 16.6.0, `window.__twin.viewpoints` |
| Load in X_ITE | ready in 2.96 s, 0 page errors | Chromium 157 + SwiftShader |

The Authored layers (`LAYER_horizon`, `LAYER_coil`: the king, ankh, Was-sceptre, arcs, field figure, sky plate, beacons) sit in `Switch whichChoice='-1'`, so the accountable file opens with the inventions hidden; `twin.html` has a checkbox to show them. Every Shape carries `MetadataSet containerField='metadata' name='gizaVI'` with its grade, label and note.

Winding: `world.mjs` arrays are clockwise-front because the Babylon page runs `useRightHandedSystem`; the exporter swaps two indices per triangle so the file uses the X3D default `ccw='true'`. Test `winding contract` checks the ground faces +y after the swap, and the X_ITE screenshots show lit, uncut solids.

## Offline tests (C)

`node --test tests/v6.test.mjs` from `v6/`: **11 of 11 pass** (Node 22.23.5, about 0.8 s). Note `node --test tests/` (a directory argument) fails to load on Node 22; pass the file.

| Test | Checks |
|---|---|
| world is deterministic and finite | two builds equal, all numbers finite, indices in range |
| census | the numbers in the table above |
| grades | every mesh graded; every `horizon` and `coil` mesh is Authored |
| winding contract | see above |
| pyramid summits | Khufu 138.5 m, Khafre 136.4 m, Menkaure 61 m today (v3 geo.py) |
| story | 16 unique shots, every caption line graded, durations sum to 216 s |
| ledger | 33 rows, unique ids, every grade used, https links |
| Tesla ledger | 12.5 GJ bank, supply-off drain 20.66 s (12.5 GJ / 605 MW), books balance, display height 571.2 m |
| sky numbers | Alnilam at transit 10.0° (10,500 BCE), 45.0° (2560 BCE), 58.8° (2000 CE) from v3 GizaSky |
| Giza to Hawara | 81.6 km great circle (haversine, R 6371.0088 km) |
| twin | byte-identical rebuild, receipt hash, XSD true, 0 semantic errors |

## The packs placed beside VI (C)

Each pack was extracted into its own empty folder, its scripts read, then its own tests run from inside the repo.

| Folder | Pack | Own tests | Browser (Chromium 157, SwiftShader) | x3d_mcp `fa5dccf` |
|---|---|---|---|---|
| `../v4/` | Hawara Witness Atlas v4.1 | 17/17 Node + `check.py` OK | 0 page errors | no X3D scene |
| `../v4-horizon/` | Giza IV Horizon Engine | 38/38 Node + 8 Python | 0 page errors | `horizon.x3d` XSD valid, 3 semantic errors |
| `../v5/` | Giza V Earth's Tesla Coil | 58/58 Node + Python OK | 0 page errors | scene XSD valid, 7 semantic errors |
| `../v3/` | Evidence Atlas (unchanged) | `make check` ALL PASSED | as before | as before |

The IV and V semantic errors are all one kind: a `MetadataString` directly under a grouping node without `containerField='metadata'`. The files are kept exactly as authored. The only edits to a pack: `v4-horizon/run.py` and `v4-horizon/tests/browser-smoke.cjs` had the path `/v4/` changed to `/v4-horizon/` so they run from their new folder. The bundled v3 copies inside the packs were byte-identical to the repo's v3 (`diff -r`), so they were not added twice.

## Browser run (C, SwiftShader)

Page boot, from the `[giza6]` log: textures 0.70 to 0.80 s (6 procedural sets on the CPU), world 70 to 150 ms, page ready 1.07 to 1.45 s, 0 page errors across 30+ loads. Each 1440x900 screenshot took 30 to 56 s of wall time on SwiftShader. The fps in the HUD is measured from frame deltas; on SwiftShader it ranges from 33 to over 1,000 depending on what is on screen and means nothing about a real GPU. **Not yet measured on real hardware**; the owner's machine blocklists WebGPU, and this page uses WebGL 2.

Known console noise: SwiftShader prints `GL_INVALID_OPERATION: glDrawElements: Must have element array buffer bound` a few times per load (warning level, frame still draws); `GPU stall due to ReadPixels` comes from the shadow and probe passes. Not chased further (S: likely an updatable `CreateLines` mesh).

Shots reviewed at 1440x900, balanced tier: all 16 in round 1, 10 again after fixes in round 2, III.1 and V.3 a third and fourth time.

## Findings while building (C observed)

| Finding | Detail |
|---|---|
| `CascadedShadowGenerator` drew nothing in the right-handed scene | 23 casters registered, `shadowEnabled` true, no shadow on the ground. A plain `ShadowGenerator` (PCF, `autoUpdateExtends`) on the same light worked at once. Cause not isolated (S: RH mode, depth clamp or SwiftShader). |
| `ComputeNormals(..., {useRightHandedSystem:true})` pointed normals inward | ground mean normal y was -0.999; dropping the flag fixed it |
| Sun intensity 5.2 with ACES hid the 0.7 m block courses | courses present in the texture (`readPixels` min/max 139/229); 2.4 brought them back |
| `engine.getFps()` returns Infinity headless | HUD computes fps from frame deltas |
| Fresnel x-ray shell at alpha 0.48 and bright emissive filled the frame white-blue at 60 m | alpha 0.06 to 0.15 and a darker rim keep the interior readable |

## Numbers checked against the packs (L)

| Claim in a pack | Check here | Result |
|---|---|---|
| Giza to Hawara "roughly 90 km" (Hawara v4.1) | haversine from Wikipedia "Great Pyramid of Giza" 29.97917 N 31.13417 E and "Hawara" 29.27417 N 30.89889 E, opened 18 Nov 2026 | 81.6 km straight line; the page says which |
| 12.5 GJ bank (Giza V) | E = ½CV² with 10 µF, 50 MV | 12.5 GJ, matches |
| supply-off drain | 12.5 GJ / (600 MW arcs + 5 MW leakage) | 20.66 s, matches V's `stepReservoir` |
