# NEXUS X3D Hub Observatory

A playable, reproducible proof of Blender as a bidirectional **X3D 4.0 hub**. Eight original synthetic chapters connect editable Blender scenes, native X3D, glTF/GLB, OpenUSD, IFC/Bonsai handoffs and rendered video. No LLM, API key or hosted service is required.

The important output is a chain you can inspect: **Blender source → X3D → a fresh Blender import → GLB and USD**. Both Blender files and the intermediate files are supplied. The showcase is built against add-on commit `cc4864c`, version 2.6.4, with Blender 5.1.2. X3D 4.0 is the format version; it is distinct from the add-on's package version.

## Open the complete release

Unzip the full release before launching it. Viewing requires Python 3 and a WebGL2-capable browser; Blender is needed only to edit/rebuild the native scenes.

- **Windows:** double-click `Start-NEXUS.bat`.
- **WSL/Linux/macOS:** run `bash start-nexus.sh` or `python3 serve.py`.
- Visit the printed local address, normally `http://127.0.0.1:8765/`. Keep the terminal open.

The viewer, X_ITE runtime, textures, scenes and film are packaged locally. It does not depend on a CDN. Opening `web/index.html` directly with `file://` is not the supported launch path because browsers restrict local asset fetches.

Use the chapter rail or the guided-play button. Drag to orbit, scroll to zoom, change camera, pause motion, and switch between the exported scene and its X3D round trip. **Inspect the evidence** opens measured scene data, checks and every artifact. Original Blender and Imported Blender are separate downloads. The director's cut is a short scored film rendered from actual X3D, not a substitute geometry renderer.

## The playlist

| Chapter | What to play with | What the files establish |
|---|---|---|
| The Asterion engine | Animated gyroscope, PBR, cyan detail-view control, amber camera-tour control | Blender hierarchy/animation export, native TouchSensor/BooleanFilter/ROUTE interactions, cameras, fresh import |
| The material spectrum | Thirty metallic/roughness combinations, glass, emission, generated texture | Principled material and UV/texture paths through X3D and downstream formats |
| One mesh. A metropolis. | 144 linked modules, multiple views, sharing inspector | Real DEF/USE reuse; a controlled single-user comparison measures file-size savings |
| The return journey | Independent authored X3D; two uses of one animated node under different parents | Actual X3D ingress, editable imported hierarchy, occurrence-aware animation and re-export |
| A scene of references | Three X3D Inline occurrences of a generated GLB asset | glTF/GLB ingestion through Blender, X3D composition and reference-aware publication |
| Open design pavilion | IFC4 building, element GUIDs, classes and synthetic material/carbon data | Actual IFC tessellation, metadata through X3D/GLB/USD, a valid IFC asset for Bonsai |
| The studio interchange | A real USD source reopened by Blender before X3D publication | USD → Blender → X3D, plus X3D → Blender → USD output |
| The articulated study | Three-joint weighted mechanical limb | Actual HAnimHumanoid 2.0, joint animation, skin weights, reconstructed armature; a partial rig, not a complete human or LOA claim |

Read [the presentation playlist](docs/PLAYLIST.md) for a timed walkthrough and suggested experiments.

## Follow one chapter through the hub

Inside `web/assets/<chapter>/`:

| File | Provenance |
|---|---|
| `scene.blend` | Editable Blender state used to make this chapter's X3D |
| `scene.x3d` | Genuine X3D 4.0 output of the pinned add-on |
| `imported.blend` | That X3D imported into a fresh Blender scene |
| `roundtrip.x3d` | Re-export of the imported scene |
| `scene.glb`, `scene.usda` | Native Blender baseline exports before the X3D leg |
| `hub.glb`, `hub.usda` | Native Blender exports **after X3D ingestion**, the downstream hub proof |
| `source.x3d` / `source.usda` / `turbine.glb` | Independent/generated ingress fixtures where appropriate |
| `evidence.json` | Counts, bounds, node types, checks and observed differences |
| `motion-evidence.json` | Matched-identity matrices at five equal elapsed-time samples |
| `poster.png`, `poster-receipt.json` | A real Blender/Cycles source-scene preview and its render settings |

The IFC source and tessellation are in `web/assets/bim_input/`. HAnim also has `skin-motion-evidence.json`. The instances chapter has both shared and single-user reference exports and `instancing-evidence.json`.

## What is measured

The released evidence records exact runtime versions and file hashes. Current measurements include:

- All eight scenes exported, imported fresh, saved as editable Blender files and exported downstream.
- Matched rigid-object identities evaluated at five identical physical times; maximum matrix-component error approximately **3.25e-5**. This is a component error, not a universal world-distance bound.
- HAnim's three joint centres within approximately **0.586 mm**, deformed-skin bounds within **0.442 mm**, and all **608 nonzero skin influences** preserved exactly in the X3D round trip.
- All **36 IFC GlobalIds** conserved in X3D, hub GLB and hub USD. The demo explicitly promotes selected imported IFC metadata to USD-compatible scalar custom properties; that adapter is visible in the source.
- Identical instanced versus single-user scenes: **407,712 vs 2,867,747 bytes**, a **7.034×** X3D size ratio. Gzip sizes are **44,413 vs 67,461 bytes**. This is not a rendering-speed benchmark.
- Official Khronos GLB validation, official OpenUSD reopening, local dependency checks and IFC reopening/tessellation. The HAnim GLBs have reported skin-parent warnings; no validator errors are suppressed.
- Twenty X3D files pass the repository's Web3D `x3d.py` node/field-validation adapter without errors or warnings. This complements the independent format audit rather than establishing visual equivalence.

`web/data/audit.json` is the independent format audit; `web/data/manifest.json` is the public playlist. Each browser route shows its own measured or unrun state. The original-versus-roundtrip structural differences remain downloadable even when the sampled geometry/motion checks pass.

## Interchange boundaries

The X3D add-on reads/writes X3D. **Blender's own exporters/importers** provide the GLB and USD bridges. **IfcOpenShell** provides the IFC parser/tessellator. **X_ITE** renders the actual X3D in the browser. The application does not pretend that the add-on directly parses IFC/USD or executes a complete X3D runtime inside Blender.

Unreal Engine and Bonsai editor imports were **not executed** in this environment. Their handoffs are concrete: actual GLB/USD/IFC files, an Unreal Editor Python adapter and inspection instructions. See [BIM and Unreal handoffs](docs/BIM_AND_UNREAL.md). Their route cards remain marked prepared/not run until those applications provide an actual receipt.

The foundry's imported timeline grows from 72 to 260 frames to accommodate the camera-tour clock. Motion preservation is tested over the source interval at equal seconds; complete clip-range equality and all long-running multi-clock behavior are not claimed. A converged file or an attractive picture is not proof of universal equivalence. This dataset demonstrates supported cases with explicit evidence and limits.

## Rebuild from a checkout

Tested build runtime: Blender **5.1.2** / bundled Python **3.13.9**, ordinary Python **3.12.14**, X_ITE **16.7.1**, IfcOpenShell **0.9.0.post1**, OpenUSD **26.11**. Install build dependencies only if rebuilding; they are not needed to view the complete release.

From this directory in the repository:

```bash
python -m pip install -r requirements.txt
npm ci --ignore-scripts --no-audit --no-fund
python vendor_runtime.py
python build_all.py --blender /path/to/blender-5.1.2/blender --repo ../..
python serve.py
```

`--skip-render` omits the CPU poster renders. Optional `--video --chromium /path/to/chrome` captures real X_ITE samples and uses FFmpeg to encode the film. Playwright is pinned in `package-lock.json`; use an installed Chrome/Chromium or install Playwright's matching Chromium. The supplied film records its actual browser and software-preview settings. It is an offline camera/interpolator capture, not a real-time FPS measurement. The film's reduced shadow profile does not modify the downloadable X3D or the normal interactive viewer.

The portable film profile captures 12 real frames per chapter at 768 × 480 with shadows disabled only for capture, then motion-interpolates each chapter separately to 24 fps. Interpolation can leave small trails on thin fast-moving geometry; the film is not a render-difference oracle. For higher-resolution output on a GPU, invoke `capture_reel.cjs` directly with larger `--width`, `--height` and `--frames`, then encode with `make_reel.py`. The native Cycles preview stills are 1280 × 800.

The standalone release can be viewed without a checkout. Rebuilding/auditing against the add-on requires passing `--repo` to a matching full repository. A Blender-installable extension ZIP for the reviewed source is included under `web/assets/addon/` in the complete release.

Reproduce the browser and native sensor tests with an existing Chrome/Chromium executable:

```bash
node verify_browser.cjs --chromium /path/to/chrome
```

The verifier serves its own local test site, loads all eight source and eight round-trip scenes, checks the actual bound camera and responsive layout, and clicks the native cyan/amber mesh controls with real mouse input. It invalidates old success receipts before a run and records the exact files served. Screenshots are optional QA output rather than a required part of the release.

## Experiments worth trying

Change a material or a parent transform in `scene.blend`, then export X3D 4.0 and inspect the result in X_ITE. Open `imported.blend` to see the reverse direction rather than assuming the first scene is the imported result. Compare the GLB produced before X3D with `hub.glb` produced after it. In the instance city, make shared mesh data single-user and remeasure the exact output sizes. In the IFC scene, trace one GlobalId from the IFC file through MetadataSet and downstream extras/custom data.

The deterministic scene recipes and playlist form a useful future input contract for an LLM assistant, but no model service is connected. A future assistant can propose changes to these recipes while the same independent evidence gates decide what worked.

## Licenses

New showcase code follows this repository's **GPL-3.0-or-later** license. Original synthetic scene/IFC data and original synthesized audio are offered under **CC0-1.0**; see `LICENSE-DATA.txt`. X_ITE is MIT-licensed and its complete bundled third-party notices are retained under `web/vendor/x_ite/`. No downloaded 3D models, proprietary textures, paid fonts or commercial music are included.
