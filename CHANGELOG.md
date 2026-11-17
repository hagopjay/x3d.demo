# x3d.demo changelog

The demo doc is the page served at the site root. Every version is kept: `docs/versions/vN/index.html` is a frozen snapshot, and `docs/index.html` is a copy of the newest one. Demos are versioned the same way (`docs/demos/<name>/vN/`). Nothing is overwritten; a change makes a new version.

## v30 (2026-11-17)
- New Demo 38: Math Lab (x3d.mathslab), six interactive X3D math labs (linear maps, derivative, integral, Fourier, Lorenz, gradient descent) built in the browser by Python under Pyodide and drawn by X_ITE, with a Manim source export. The lab lives in its own repository, so the card links its live page (`https://hagopjay.github.io/x3d.mathslab/`, 200 when checked) and its source. New card picture `docs/assets/math-lab.jpg` (a headless screenshot of the live page, 1280 x 720 scaled to 960 x 540), the snapshot `docs/versions/v30/index.html`, and a SOURCES line for the picture. Held until the lab's thread confirmed the live URL.
- Still held, URL not live: Accretion static viewer (planned Demo 39) and Gobbler Evidence Loom (requested Demo 40). Numbers go in the order cards ship, so these may shift.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll and the card picture loads.

## v29 (2026-11-17)
- New Demo 37: Flop Lab (x3d.gamelab), a 2.5D ragdoll stunt platformer on an editable X3D 4.0 level, a custom XPBD-style JavaScript solver and the three.js bridge. The demo lives in its own repository, so the card links its live page (`https://hagopjay.github.io/x3d.gamelab/`) and the frozen build 0.3.0; nothing is copied into this repository. New card picture `docs/assets/flop-lab.jpg` (the project's own `docs/media/flop-midair.png`, cropped and scaled to 960 x 540), the snapshot `docs/versions/v29/index.html`, and a SOURCES line for the picture. Counts on the card (255 RigidBody nodes, 182 joints) are from the game's thread; the page here was not re-run.
- Giza v3 (Evidence Atlas, PR 46) is merged and still unnumbered and off the shelf, as are Giza v2 and the trace viewer; no lane has asked for cards. No demo and no earlier version is touched; v1 to v28 unchanged.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll and the card picture loads.

## Unnumbered, Giza v3: the Evidence Atlas, ready for development (2026-11-17)
- New demo `docs/demos/giza-osiris-hall/v3/`; v1 and v2 are untouched. No front-page card and no doc version: numbering belongs to the site owner, so this is offered, not shelved. The v3 page says "Evidence Atlas / 03".
- From the Evidence Atlas upgrade (an uploaded enhanced v2 edition, reviewed first and merged as plain files): evidence tiers shown separately from geometry status and source handling, survey overlay with compass and metric rings, a north-side section plane, a depth theatre comparing the 30.37 m shaft-drop sum with the 35.45 m published section label and the disputed 648 m claim, an observer-centred precession sky with shortest-arc rotation interpolation, a camera notebook with session export and import (input hashes recorded), focus mode, keyboard shortcuts, and a field guide with six experiments. Corrected "41 named stars" to 40 named plus 978 field stars (counted from `stars_v2.json`).
- Ready for heavy development: `make check` (30 Node and 8 Python tests plus JSON, syntax and cross-reference checks, about 3 s), `make gate`, `make smoke`, `make rebuild`, `make package`, `make sweep`; `DEVELOPING.md` (code map, six contracts that break silently, recipes), `ROADMAP.md` (ranked backlog with a done-when for each item), and a path-filtered CI workflow `.github/workflows/giza-v3.yml` that runs `make check` and the leak sweep.
- Checks: first fresh full gate of the enhanced scene, x3d_mcp `fa5dccf`: XSD 4.0 valid, Immersive profile, 0 errors, 0 warnings, 133 info notes (`validation-v3.json`, tied to the scene SHA-256 `59bce411...9aebb5`). Smoke test in headless Chromium on a software adapter: 12 of 12 pass at 1280 and 390 px, no page errors, no horizontal scroll. Nothing was timed; no GPU run yet.
- Scene file renamed `giza-atlas-v3.x3d` (bytes unchanged). `validation.json` and `BASELINE-NOTICE-v2.md` are the frozen v2 baseline and are kept exactly.
- Licences are unchanged: geometry CC0, `stars_v2.json` derived from HYG v4.1 (CC BY-SA 4.0), X_ITE 16.6.0 vendored with its licence. The folder is about 20 MB.

## v28 (2026-11-17)
- Demo 35, Nine twins that answer questions and catch planted faults, gets a version 2 link: evidence badges on every answer (`docs/demos/semantic-twins/v2/`, x3d.demo PR 44). A new version of Demo 35, not a new demo: the number stays 35 and the card keeps its v1 link. The card quotes the state counts from PR 44's description. No new picture; the snapshot `docs/versions/v28/index.html` is a copy of the new front page. No demo and no earlier version is touched; v1 to v27 unchanged.
- The card points at a path that arrives with PR 44; merge PR 44 before, or with, this one.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll.

## v27 (2026-11-17)
- Demo 34, Semantic Twin Lab, gets a version 2 link set: the Evidence Edition (`docs/demos/ontology-lab/v2/`: `index.html`, `workbench.html`, `ONTOLOGY-FIELD-GUIDE.html`), added in x3d.demo PR 42. It is a new version of Demo 34, not a new demo, so the number stays 34 and the card keeps its v1 link. The card text names the three additions (witness workbench, field guide with a second-engine re-measurement, study audit). No new card picture; the snapshot `docs/versions/v27/index.html` is a copy of the new front page. No demo and no earlier version is touched; v1 to v26 unchanged.
- The card points at v2 paths that arrive with PR 42; merge PR 42 before, or with, this one.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll.

## Unnumbered, Giza v2: below the surface and up to the stars (2026-11-16)
- New demo `docs/demos/giza-osiris-hall/v2/`, a second version of the Giza study (v1, `docs/demos/giza-osiris-hall/v1/`, is untouched and still works). No front-page card and no doc version: the site owner numbers the front page (the Giza v1 entry below was labelled v20 before numbering moved), so this is offered, not shelved.
- What is new: real Blender Cycles light baked into vertex colour for sunrise, midday and afternoon (192 samples, receipts in `states.json`, script fingerprint in the file); the star catalogue from the x3d-blender-io demo page rotated into place with a precession scrub from 13,000 BC to 2100 AD, Orion's Belt, Leo and the Orion Correlation overlay; a walkable imagined Hall of Records interior, labelled speculative; Khufu's interior drawn from the survey record; three translucent glass lenses on toggle buttons (Technical, Wonder, Contested, plus the Ledger) where each Contested card is told as claim, then evidence.
- Ground truth fixed against v1 (v1 left as published): Great Pyramid entrance 7.29 m east of the axis, King's Chamber long axis east-west, Queen's Chamber box no longer transposed, Osiris Shaft under Khafre's causeway (Hawass 2007 p. 381), claimed cubes 90 m a side, the "12 x 9 x 5 m" anomaly stated as about 9 by 12 m in plan buried less than 5 m, the unsourced 41.48 m depth flagged instead of drawn as fact, Hawass 2007 cited as CASAE 36, the Orion Correlation credited to Bauval 1989 and 1994.
- Content: 75 cards (32 Technical, 21 Wonder, 22 Contested) citing 128 links, and a 25-row claim ledger (17 documented, 3 theorized, 5 speculative). A separate audit pass read each card against its sources: 47 corrected, 2 dropped; titles and number rows it flagged were corrected by hand. Every claim carries a grade (Confirmed 33, Likely 41, Suspected 1 on the cards); sources the research pass opened are marked with a check, the rest with a hollow circle. `research-log.md` keeps the agent notes and every change the audit made.
- Checks: x3d_mcp validator (main 13121b6) says XSD 4.0 valid, 0 errors, 0 warnings, 124 info notes about DEFs used from the page, 2,456,501 bytes (`validation.json`). Headless Chromium on a software adapter (SwiftShader), desktop and 390 px: all four lenses, keys 1 to 4, Esc, chips, fly-to, layer toggles, four light states, sky scrub and the tour captions work, no page errors, no horizontal scroll. Nothing was timed on the software adapter.
- Credits and licences are in `NOTICE.md`: the HYG star database v4.1 (David Nash, CC BY-SA 4.0) makes `stars_v2.json` a derived work under the same licence. The page does not endorse the Cayce, Orion Correlation or "648 m" ideas; it draws them so they can be read next to measured sizes. `build/` holds every script and the raw Cycles outputs so the scene rebuilds without Blender.
- X_ITE 16.6.0 is vendored in the demo folder, as for the other demos; the folder is about 20 MB.

## v26 (2026-11-17)
- Front-page cards for three demos from the semantic-twins lane, in the suggested order: Demo 34 Semantic Twin Lab (`ontology-lab/v1`), Demo 35 Nine twins that answer questions and catch planted faults (`semantic-twins/v1`), Demo 36 Ontology field notes (`ontology-field-notes/v1`). New card pictures `docs/assets/{ontology-lab,semantic-twins,ontology-field-notes}.jpg` (headless screenshots of each page, 1280 x 720 scaled to 960 x 540), the snapshot `docs/versions/v26/index.html`, and a SOURCES line for the pictures. No demo and no earlier version is touched; v1 to v25 unchanged.
- The three cards point at demo paths that arrive with x3d.demo PR 40; merge PR 40 before, or with, this one.
- Still unnumbered and off the shelf: Giza v2 (PR 38) and the trace viewer (PR 39). Their lanes did not ask for numbers; a card can be added in a later version.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll and the card pictures load.

## v25 (2026-11-15)
- Front-page numbering for the day's demos, in one place. Already on the page: Demo 25 Three authors, one scene, Demo 26 Touch a million triangles, Demo 27 One scene, nine looks (v24). New cards in this version: Demo 28 Typed X3D (`typed-x3d/v1`, shown without a number since v23; its card moves to follow Demo 27), Demo 29 Path-traced X3D (`three-pathtracer/v1`), Demo 30 Timelines to X3D (`timeline-theatre-gsap/v2`, with v1 linked), Demo 31 Four physics engines, one X3D scene (`rigid-engines/v1`), Demo 32 Five X3D features computed on the GPU (`webgpu-compute/v1`), Demo 33 glb Forge (`glb-forge/v1`). New card pictures `docs/assets/{three-pathtracer,timeline-theatre-gsap,rigid-engines,webgpu-compute,glb-forge}.jpg`, the snapshot `docs/versions/v25/index.html`, and SOURCES lines for the pictures. No demo and no earlier version is touched; v1 to v24 unchanged.
- Correction to the v23 entry (left as written): its line "New Demo 25: Path-traced X3D" is Demo 29, because Demo 25 is Three authors, one scene. The v23 and v24 front pages also had a missing `</div></section>` between the Typed X3D card and the Three authors card (the second sat inside the first); v25 closes and reopens them.
- Correction to the v24 section below: the lines that follow its two bullets (glb Forge, WebGPU compute under an "Unnumbered" heading, a second "v24" heading for Four physics engines) came from PRs 33, 34 and 35 and are not part of this page version; they describe Demos 33, 32 and 31 and are now shelved by this version. Those words are left as written.
- Timelines to X3D version 2 (PR 28) was merged marked work in progress, review pending; the card says so.
- Checked in headless Chromium: the front page lays out at 1280 and 390 px with no horizontal scroll, all card pictures load and every card link points at a file that exists in the repository.

## v24 (2026-11-15)
- New Demo 26: Touch a million triangles (`docs/demos/three-bvh/v1/`), an X3D ElevationGrid of 125,000 to 1,000,000 triangles under a TouchSensor, drawn by the three.js bridge with a three-mesh-bvh bounds tree behind the picker; tree on and off, a race against the plain raycast, a 24,000-ray scan. Card image `docs/assets/three-bvh.jpg`.
- New Demo 27: One scene, nine looks (`docs/demos/three-style-board/v1/`), one X3D scene drawn nine ways with TSL node materials, three scenes, code on every tile. Card image `docs/assets/three-style-board.jpg`.
- Both demos arrived in PR 31 without front-page cards; this version adds the two cards and the version snapshot only. Numbers 26 and 27 are the next free after Demo 25; the Path-traced X3D and Timelines demos (`three-pathtracer`, `timeline-theatre-gsap`) are not on the shelf yet and their numbers are not taken here. Demos 1 to 25 and v1 to v23 unchanged.

- New demo: glb Forge (`docs/demos/glb-forge/v1/`), the browser face of the glTF tooling lane (`x3d.loom/x3d.gltf`). You pick a scene (PRISMATICA cathedral, Asterion, LUMEN, Still life) and a profile, the page runs the optimiser on the original glb bytes in your browser (400 KiB esbuild bundle of glTF-Transform and meshoptimizer, in a worker), then shows the result in three.js r187 as a wipe or a difference picture against the original, with file, gzip, draw-call, triangle, node and identity counts beside it.
- What the page is about: identity. The audit table lists every DEF-tagged node before and after, the three buttons below it run stock glTF-Transform `instance()` and `join()` against the lane's `instanced` profile on the cathedral (stock `instance()` takes 1,218 draw calls to 10 and erases 1,216 of 1,251 identity tokens; the lane's profile takes 1,218 to 10 and keeps 1,251 of 1,251), and a gate panel prints each pass or fail with the number and the bound.
- Browser against Node: the page compares the bytes it made with the Node CLI's recorded bytes (`forge-receipts.json`, instruments named in the header chip). Draco, KTX2 and the Khronos validator run in Node only; their rows are receipts, marked as such, and the page says which numbers are live and which are recorded.
- Scene files: five optimised glbs and one source glb under `scenes/` (5.3 MB), copied from the lane's `make-demo-assets` output; everything else is built in the page. three.js loads from jsdelivr, so the page needs a network.
- Front page untouched (the site owner's); nothing is overwritten; v1 to v22 unchanged. v23 belongs to a sibling branch and is not merged here.
- Checked in headless Chromium on a software adapter (Chromium 153.0.8010.12 SwiftShader): page loads, the instanced profile runs and passes in the page, the stock-`instance()` trap runs, no page errors; a separate run of the browser against the receipts matched 32 of 32 byte comparisons. Nothing timed on a GPU.
## Unnumbered, WebGPU compute demo (2026-11-15)
- New demo `docs/demos/webgpu-compute/v1/` (no front-page card and no doc version: the site owner numbers them, as for the other not-yet-shelved demos). Five live scenes whose per-frame arithmetic runs in WGSL compute shaders: ParticleSystem (up to 2 M particles), GaussianSplats (EWA projection and a GPU bitonic sort), NurbsPatchSurface tessellation, HAnim skinning, VolumeData ray marching. Every scene reads its X3D fixture, shows the X3D it is drawing, and prints GPU timestamps, not frame counters. Two buttons run the repo's correctness gate (each kernel against its CPU twin) and a quick benchmark on the viewer's own GPU, with the recorded SwiftShader run beside it.
- Kernels, CPU twins, fixtures, harness page and the recorded receipt are copied unchanged from x3d.loom `x3d.compute` into `compute/`. A page without `navigator.gpu` shows a fallback picture and says why.
- Checked in headless Chromium 153.0.8010.12 on a software adapter (SwiftShader): all five scenes run with no page errors, the in-page gate passes 5 of 5. A real WebGPU canvas never presents under headless SwiftShader, so screenshots use the `?dbg=offscreen` path, which renders offscreen and blits. Not checked on a real GPU or a phone. Timings on the page from a software adapter are scaling numbers, and the page says so.
## v24 (2026-11-15)
- New demo, not yet on the front-page shelf: Four physics engines, one X3D scene (`docs/demos/rigid-engines/v1/`), built from x3d.loom `x3d.physics/rigid-engines` (Rapier 0.21.0 and cannon-es 0.20.0 behind RigidBodyCollection, one adapter, no bridge file edited). Three scenes (avalanche of 40 bodies, Newton's cradle, gate with hinge and slider limits and a bouncing ball); one live X_ITE 16.6.0 pane (its own Bullet) beside three script-free replays of the built-in engine, Rapier and cannon-es, with a shared scrub bar, per-pane readouts and a measured table.
- Numbers on the page come from `data/stats.json` (recorded in Node v22.23.4) and x3d.loom `rigid-engines/results/*.json` (Chromium 153.0.8010.12 SwiftShader, X_ITE 16.6.0, Rapier 0.21.0, cannon-es 0.20.0). Findings shown: the built-in engine has no collider for Cone (10 of 40 avalanche bodies escape), cannon-es adds energy in a bounce-1 chain, Rapier needs 4 sub-steps for a cradle (0.22 m to 0.65 m last-ball rise), X_ITE never applies hinge limits.
- Live pane loads X_ITE 16.6.0 from a CDN and rewrites `FRICTION_COEFFICIENT-2` to `_2` before loading, since X_ITE reads the underscore spelling. The recordings were not replayed in a second host.
- Checked in headless Chromium on a software adapter: all three scenes load, the four panes run, pause and scrub work, no page errors, no horizontal scroll at 390 px; nothing timed.
## v23 (2026-11-15)
- New: Typed X3D (`docs/demos/typed-x3d/v1/`), a page that holds LLM-written X3D to the Web3D X3D 4.0 JSON Schema with Zod running in the browser (bundle generated by `x3d.loom` `x3d.zod/`, Zod 4.6.7). Nine realistic model mistakes on an animated orrery, each shown with its exact error path and a repair prompt; a vocabulary mask that shrinks the schema (502,810 B to 25,635 B for 19 nodes, lean) and the keys legal at each position; a 9-mistake matrix over three gates (JSON Schema live; XSD and semantic recorded with x3d_mcp fork fbe165f); the 1,533-scene corpus run, the fuzz result and the root causes of the 190 XSD/JSON-Schema disagreements.
- Front page gets the Typed X3D card; the v22 snapshot is unchanged. The page reads X_ITE from Demo 12's vendor folder (no copy) and carries its own copy of Web3D's JSON Schema file (sha1 c6765a4) and the Zod bundle.
- Checked in headless Chromium on a software adapter: gate opens and closes for all nine mistakes, X_ITE renders the clean scene, no page errors, no horizontal scroll at 390 px; the corpus numbers are from the repo run, not timed in the page.
- Demo 25, Three authors, one scene (`docs/demos/yjs-collab/v1/`): live multi-user editing of an X3D scene with Yjs. Three peers (two X_ITE browsers and a scripted agent) each keep their own copy; a scripted three-act story shows concurrent edits, a network split with four kinds of clash and the rule that settled each, a rescue button and a history scrubber. Built from x3d.loom PR 74 (`x3d.yjs/`, `demo/showcase`); X_ITE 16.6.0 and Yjs 13.6.33 (MIT, `NOTICE.md`) bundled, no network requests. Checked headless (Chromium 153, SwiftShader): hashes differ during the split and match after, X_ITE node sets equal the document on all three peers, no page errors.
- New card image `docs/assets/yjs-collab.jpg`. Demos 1 to 24 unchanged.
- New Demo 25: Path-traced X3D (`docs/demos/three-pathtracer/v1/`). One X3D file drawn by X_ITE 16.6.0 and, live in the page, by three-gpu-pathtracer 0.0.28 through the x3d.threejs bridge reader and body; a wipe, a bounce slider, an "emissive surfaces cast light" switch and three scenes (Cornell box, PBR grid, light ladder from x3d.lab Leg E). Measured object-pixel FLIP of the path tracer, the bridge raster and Cycles against X_ITE, with the rig named; noise floor 0.055. Not on the front-page shelf yet.
- Vendored: three r187, three-mesh-bvh 0.9.18, three-gpu-pathtracer 0.0.28 (MIT) and the bridge bundle built from x3d.loom; X_ITE is read from the LUMEN Interference demo's vendor folder.
- Checked in headless Chromium on a software adapter (181 samples, X_ITE scene loaded, path-traced canvas non-black); no real-GPU timing, nothing claimed about speed.
- New demo, not yet on the front-page shelf: Timelines to X3D, Theatre.js and GSAP (`docs/demos/timeline-theatre-gsap/v1/`), built from x3d.loom PR #73 (`x3d.anim`). Live X_ITE pane (vendored 16.6.0 from Demo 12's folder) with the exported TimeSensor and interpolators, or GSAP driving the same scene live through the SAI; an ease lab that bakes any GSAP ease in the page; the colour finding (ColorInterpolator blends in HSV); licence notes (Theatre core Apache-2.0, studio AGPL-3.0, GSAP standard licence). GSAP 3.15.1 loads from jsDelivr. The src files are copies of `x3d.anim/src` at that PR; scenes and receipts are copies of its fixtures and receipts.
- Numbers on the page are read from the receipt JSON: bridge vs X_ITE worst 5.7e-7, X_ITE vs the tools 0.0069 (Theatre) and 0.0137 (GSAP), 12 picture pairs worst 46.95 dB. Rig: Chromium 153.0.8010.12 SwiftShader, X_ITE 16.6.0, three.js r187, GSAP 3.15.1, @theatre/core 0.7.2.
- Checked in headless Chromium on a software adapter: both scenes load, both clock modes run, the ease lab and colour strip draw, no page errors, no horizontal scroll at 390 px; nothing timed. The front page is not edited (left to the demo-site owner); v1 to v22 unchanged.

## v22 (2026-11-14)
- Demo 24 version 2 (`docs/demos/bridge-blenderizer/v2/`): the bridge and the blenderizer page rebuilt beside version 1, which stays as it was. New: a physics section (11 nodes, batches 37 and 42, merged on x3d.loom main as PR 56 and PR 61; two new Babylon-beside-X_ITE picture grids, the hinge-limits difference, the engine and X_ITE Bullet notes) and a volume section (10 nodes, batch 43, x3d.loom PR 63, head 7bca6e3, merged into main 14 Nov 22:23Z; the page was built from its head; eight new picture pairs, one per style), a "what's left and what may come" board (tracker counts from NODES.json at 7bca6e3, plus placeholders and a card for the three.js scaffold, x3d.loom PR 64 and 65), and the gallery rebuilt from receipts (53 pictured nodes; shots on a sub-region or with widened masks are marked).
- Corrections from an independent fact-check of version 1, applied in version 2 only: tile and gate wording (what 226 of 260 counts, what the 43 of 43 gate does and does not measure), the gate diagram, batch numbers on cards, the scorecard caveats, the NURBS-weights strip (neither Cycles nor the glb draws the curve, so the caption now says Babylon scores well partly by omission), "differs from X_ITE" grouped by whether it follows the standard's maths or is our choice.
- New measurement, not in the bridge repo: on a smooth 32 x 32 x 32 field turned 0.7 rad, the lit volume styles (Shaded, ToneMapped, iso surface) differ from X_ITE far more than the batch's cube fixtures do (mean |Δ| 9.2 to 11.1 of 255). Unrotated twins of those three scenes show why: turning the volume moves the bridge's mean colour by 0 to 2 levels and X_ITE 16.6.0's by 50 to 81, and unturned the engines are much closer (|Δ| 4.5 to 4.9). The Babylon bridge lane's own check found the same; suspected cause (not isolated here) is the gradient's sign or frame under rotation. Edge and Cartoon differ too and were drawn only turned. Smooth fields draw as dim shells in both engines (no opacity correction). The scenes, their unrotated twins (`*-r0`) and test specs are published in `docs/demos/bridge-blenderizer/v2/lab-scenes/`.
- Version 2 reads its live-pane scene files from version 1's folder (no copies). Front page: the Demo 24 card points to version 2 and lists version 1; the card's counts are corrected (226 recognised = 158 added, 95 clean and 63 with logged gaps, plus 68 earlier).
- Checked in headless Chromium on a software adapter: both live panes load, no page errors, all images load, no horizontal scroll at 390 px; nothing timed. Pictures: Chromium 153.0.8010.12 SwiftShader, X_ITE 16.6.0, Babylon.js 9.32.0.

## v21 (2026-11-14)
- New Demo 24: The bridge and the blenderizer (`docs/demos/bridge-blenderizer/v1/`), a rebuild of the add-on showcase around both translators. It sits beside Demo 12 (Checkable 3D, untouched) and the add-on's own page; nothing is overwritten. Contents: a live X_ITE 16.6.0 pane (X3D) beside a live Babylon.js 9.32.0 pane (glb written by the add-on) for three Blender scenes; the 260-node X3D 4.0 atlas from x3d.loom `bridge/NODES.json` at ed1bed8 (216 read, 95 bridged, 53 gaps, 35 todo, 8 claimed, 1 blocked); 53 receipt pictures (Babylon beside X_ITE) from `bridge/receipts/shots`; a table of cases where the bridge follows the standard and X_ITE does not (BATCH-44); the add-on's gate run (43 of 43, 42 PASS and 1 IMPROVED, Blender 5.3.0, Khronos validator 2.0.0-dev.3.10, 0 errors), the sRGB round-trip audit (3.2e-6) and scorecard v3 (15 scenes, FLIP vs Cycles; the Babylon-over-X_ITE margin is inside its confidence interval and the page says so).
- Scene files copied: PRISMATICA, Asterion and Still life from x3d-blender-io `docs/brag`, Still life's stage from Demo 12. The page loads X_ITE from Demo 12's vendor folder. The live Babylon pane loads plain glb, not the bridge reader (the bridge needs WebGPU).
- Front page gets the Demo 24 card; v20 (Giza) has no front-page snapshot. v1 to v19 unchanged.
- Checked in headless Chromium on a software adapter: both live panes load for all three scenes, no page errors, no horizontal scroll at 390 px; nothing timed.

## v20 (2026-11-13)
- New study, not yet on the front-page shelf: Giza, Osiris Shaft and Hall of Records (`docs/demos/giza-osiris-hall/v1/`): one X3D 4.0 scene with documented, theorized and speculative layers, a 13-row graded claim ledger, a guided descent and eight views. X_ITE 16.6.0 bundled; validator clean (0 errors). All underground positions are schematic. Checked on a software adapter only; nothing timed. The front page and earlier versions are untouched.

## v19 (2026-11-09)
- New Demo 23: Gobbler Gyroscope on Babylon.js 9.32.0 WebGPU (`docs/demos/gobbler-gyroscope-webgpu/v1/`): the Gyroscope 8K edition with the Meridian refinement and the GPU kinetics stage. Three files: the page, its scene and the graph it reads. Public-copy edits: the three outside GitHub handles became "Open-source maintainer" (as in Demo 18), and five in-page links were repointed to this site's folders (see SOURCES.md).
- The front-page introduction edited on `main` (9db2b1d) is kept as it is.
- Checked on a software adapter only: loads, the compute pass runs, the hoops move, no page errors; nothing timed.

## v18 (2026-11-08)
- New Demo 22: Library Hall on Babylon.js 9.32.0 WebGPU (`docs/demos/library-hall-webgpu/v1/`), the build of x3d.loom PR #27 (open when hosted), 87 files as built: the page, the 14 MB `hall.x3d`, textures and the bundled X_ITE 16.5.1 for the page's comparison button. Nothing changed.
- Checked on a software adapter only: loads and draws two film views with no page errors beyond a missing favicon; Text nodes are not drawn; nothing timed.

## v17 (2026-11-08)
- New Demo 20: Gobbler Demiurge on Babylon.js 9.32.0 WebGPU (`docs/demos/gobbler-demiurge-webgpu/v1/`), built from x3d.loom PR #24. **The knowledge graph is redacted in this public copy**: 488 of its 3,759 entries and 566 of its 2,412 relations that touched private notes, named people, costs, accounts, private files or links were blanked (label "(redacted ...)" or "A person", no text), every source file name was dropped from all entries, and the structure, counts and positions are unchanged. The scene, audio, village and code are as built. One sentence and a back link were added to the page's About text (hash change in SOURCES.md).
- New Demo 21: Dynasty Loom on Babylon.js 9.32.0 WebGPU (`docs/demos/dynasty-loom-webgpu/v1/`), built from x3d.loom PR #25 (bundle id 1d8afc5d1e5c). A hybrid: the hypersphere view is on Babylon, the tapestry view on X_ITE 16.5.1. All files are as built; the 26 AI portraits carry their own labels.
- Checked on a software adapter only: Demo 20 loads (2,476 stars, bird on screen, hover cards render, no page errors); Demo 21 loads (hypersphere ready, WebGPU, no page errors); nothing timed.

## v16 (2026-11-08)
- New Demo 19: Material Odyssey on Babylon.js 9.32.0 WebGPU (`docs/demos/material-odyssey-webgpu/v1/`), built from x3d.loom PR #23 (main 60824ce, bundle id c047da7784b2). A copy of the Material Odyssey film page with a third engine added; the X_ITE and three.js engines and their vendor folders are byte for byte as they were. One edit on this site: the page's "Back to the landing page" link, which pointed at a private page, now reads "Back to the demo page" and goes to this site's front page (sha256 changed from the build's output, see SOURCES.md).
- Checked on a software adapter only: loads with 286 meshes, 74 lights, no page errors apart from X_ITE's own missing line-type texture; nothing timed.

## v15 (2026-11-08)
- New Demo 18: Gobbler 3 on Babylon.js 9.32.0 WebGPU (`docs/demos/gobbler3-webgpu/v1/`), built from x3d.loom PR #22 (build id e4a4f247bb47). One offline page plus the three data files its "Take it with you" line links to. Four in-page links were repointed to this site's folders (the page's sha256 changed from 54f2185c… to 69e89297…, see SOURCES.md). The three individual outside GitHub handles in the graph were replaced with "Open-source maintainer" before the build. The X_ITE "cabinet of worlds" Gobbler (Demo 17) is a different page and is untouched.
- Checked on a software adapter only: loads with 121 entities and no page errors; six views 14.6 to 19.7 dB against X_ITE 16.5.1 (phase differences); nothing timed.

## v14 (2026-11-08)
- The "A Claude artifact" card stays on the shelf, with its wording updated now that the artifact page is open to anyone with the link (it said it would open once made public). The v13 snapshot is unchanged.
- The x3d.STEM shelf card links to the repository's own Pages site (https://hagopjay.github.io/x3d.STEM/, live since 7 November).
- No demo changed.

## v13 (2026-11-08)
- New Demos 12 to 17, all X3D drawn by X_ITE (WebGL), each self-contained with its X_ITE bundled:
  - 12, Checkable 3D: the Blender X3D I/O showcase, twelve live scenes (`demos/blender-x3d-io/v1/`).
  - 13, X3D ↔ MuJoCo authoring bridge, with real MuJoCo 3.17.0 in WebAssembly (`demos/x3d-mujoco-bridge/v1/`).
  - 14, the X3D Ontology as a constellation (`demos/ontology-constellation/v1/`).
  - 15, Dynasty Loom, an atlas of three families (`demos/dynasty-loom/v1/`).
  - 16, Confluence, IFC ↔ X3D, as a read-only copy that replays one recorded revision of the live studio (`demos/confluence-ifc/v1/`).
  - 17, Gobbler, a cabinet of worlds (`demos/gobbler-worlds-within/v1/`).
- Shelf: a link to a Claude artifact. It needed a sign-in when added; the owner will make it public.
- Checked in a headless browser on a software GPU, correctness only:
  - every page loads with no failed requests;
  - all 24 showcase scenes load (`annotation.x3d`'s unknown node is that demo's subject);
  - the bridge's physics runs;
  - the IFC copy loads from a subpath with no server;
  - Gobbler's Pantheon loads.
- Not checked: listening, real GPUs, other browsers, timings. Provenance and hashes are in `docs/demos/SOURCES.md`.

## v12 (2026-11-07)
- New Demos 10 and 11: Chirp and Electron Cloud Observatory on Babylon.js 9.32.0 WebGPU (`docs/demos/chirp-webgpu/v1/index.html`, `docs/demos/electron-cloud-webgpu/v1/index.html`). Each is one offline file built from x3d.loom PR #21 (commit d323213, still open when built) with `build-chirp.py --kind chirp|cloud --study docs/demos/stem/v1/<study> --single`; the X_ITE study pages (`demos/stem/v1`) are untouched and each Demo 5 card links to its WebGPU version. Cards state the logged parity gaps and what was not checked (audio on Chirp, other browsers, real GPUs); no Timing button yet.
- Both pages ran in a headless browser on a software WebGPU: each study's own browser witness passed, no console errors.

## v11 (2026-11-07)
- New Demo 9: the Manifold of emotion on Babylon.js 9.32.0 WebGPU (`docs/demos/manifold-webgpu/v1/`, built by the x3d.loom PR #19 manifold thread with `build-manifold.py --site`; the shipped site tar had sha256 ef55572ad4d950a24b672570e47cdc42ecc8d43073d1204b615ad215ea52abb5 and was copied unchanged). The X_ITE manifold (Demo 4, `demos/manifold/v1`) is untouched and linked as its non-WebGPU twin, and Demo 4 now links here. Opt-in Timing button on the page; no timing exists yet. Card text carries the 49.3 and 48.5 dB software-GPU comparisons and says what was not run.
- Demo 3 gains a link to Neural Canvas v2 (`demos/brain-torso/v2/`, added by PR #11: same pixels, adapter retry, Windows flag note, opt-in Timing button); v1 stays.
- Not yet: KANSEI v1.1 (texture-request fix on the platformer site) answered 404 when this was built, so Demo 6 still points at v1.

## v10 (2026-11-07)
- Demo 7 Loomsong is now playable at `docs/demos/loomsong/v1/` (x3d.music at 4a7bdbd: worlds and page rebuilt with `gen/world_ode.py`, `gen/world_turca.py` and `page/build_page.py --no-audio`; the worlds came out byte-identical in size to the preview's; page wrapped in a full HTML document, the host report switched off; audio masters and the four animated cards are the preview version 2 files, sha256 in SOURCES.md). NOTICE.md and LICENSE travel with it; CC BY-NC-SA 4.0 for everything derived from the Alla Turca score.
- New Demo 8 Tether Firehose 4 (x3d.ML demo/v4 at a2bddac, built with `build_v4.py --share`, X_ITE 16.5.1 added as its own files). The share build's SAFE map removes lane names, hardware and run costs; its sweep said clean, and the served text was checked again by hand.
- The shelf adds x3d.ML and a Play link for x3d.music.
- Verified in a headless browser (software GPU, no timings): both pages load with no console errors and no failed requests; Loomsong plays with sound start on a click.

## v9 (2026-11-07)
- Demo 7: Loomsong (Beethoven's Ode to Joy and Mozart's Rondo alla Turca as machines), source only: hagopjay/x3d.music has no Pages site, its README says publishing has not started, and the audio masters are not committed. The card says so, repeats the repository's "no human has listened yet", and carries the non-commercial licence that the Alla Turca score imposes.
- New shelf "More from GitHub, since 7 October": live sites (PolyXandria demos on x3d.poc, x3dom.fun, Mashtots System 2, KeGG, Dirac, KANSEI) and source-only repositories (x3d.music, x3d.loom, x3d-blender-io, x3d_mcp, x3d.xray, x3d.onto, x3d.STEM). Every live link answered 200 when linked. Forks of other people's projects and private repositories are left out. x3d.ML is not linked until its owner decides about a data file it serves.
- The x3d.STEM front page link on the hagopjay Pages domain was replaced by the manifold's original site: that front page answered 404 when v9 was built (it answered 200 earlier on 7 November). Nothing hosted here depended on it.
- Demos 1 to 6 unchanged.

## v8 (2026-11-07)
- Demo 6: KANSEI, the Babylon flagship (a night-drift game, Babylon.js 9.32.0 on WebGPU through our own X3D reader). It is hosted in its own repository, hagopjay/platformer, at https://hagopjay.github.io/platformer/kansei/v1/ (answered 200 when linked), so this page links to it and copies nothing. Preview image is the Babylon half of a recorded comparison sheet (software GPU, correctness only) from x3d.loom `runs/webgpu-drift-20261107/`. Source: x3d.loom PR #17.
- Demos 1 to 5 unchanged.

## v7 (2026-11-07)
- Demo 5, STEM studies, now run live: Chirp, Electron Cloud Observatory, Turing Garden, Living Heart, Vortex Reconnection & Sound (`docs/demos/stem/v1/<study>/`). The x3d.STEM repository does not commit the studies' data files, so each study's own builder was run (`python3 -E -s tools/<builder>.py`, numba and numpy, CPU) and its output bundled. Every case: all witnesses green (Vortex 10 and 11, Living Heart 8, 7 and 10, Turing Garden 14, 14, 14, 14 and 12, Chirp and Electron Cloud green). Each page then verified its data against the repository's recorded hashes, and its in-browser meshes against the builder's (41 of 41, 36 of 36, 48 of 48 frames), in a headless browser on a software GPU. Kerr 2 is not hosted (about 330 MB of images); it stays a source link.
- Demo 4, the manifold, is now hosted too (`docs/demos/manifold/v1/`, from the repository's `studies/manifold`; five key files identical by hash to the original site). The debrief's comparison frames and the builders are left out of this copy.
- X_ITE twin of Neural Canvas (`docs/demos/brain-torso-xite/v1/`): the page the WebGPU version was ported from, X_ITE 16.6.0 bundled, same notices. Demo 1 links the collider's X_ITE twin on the dirac Pages site.
- Demos 1 to 3 (WebGPU) unchanged.
- Fix after merge: the X_ITE twin's bundled X_ITE files were left out of the first push by the page's own `.gitignore` (the page worked through its CDN fallback). They are now in `docs/demos/brain-torso-xite/v1/vendor/` and the ignore file is removed from the hosted copy. No page file changed.

## v6 (2026-11-07)
- Demo 4: Manifold of emotion (X3D 4.0, drawn by X_ITE 16.5.1, not WebGPU). It lives on a sibling repository, x3d.STEM, so the doc links out to it and shows a screenshot (`docs/assets/manifold.jpg`, drawn on a software GPU, status strip cropped out). Nothing from it is copied into this repository.
- New STEM shelf: the six x3d.STEM studies (Kerr 2, Turing Garden, Electron Cloud, Chirp, Living Heart, Vortex Reconnection & Sound), linked to their source and evidence in hagopjay/x3d.STEM, not to live pages: their data files are not committed, so the published study pages stop at "could not be shown" (checked in a headless browser, 6 of 6 give 404 on their data files). They can point at live pages once the data is published.
- Demos 1 to 3 unchanged. The lede now says which demos need WebGPU.

## v5 (2026-11-07)
- Demo 3 is now Neural Canvas, the brain and torso CT drawn with Babylon.js on WebGPU through our own X3D reader (built from x3d.loom PR #13 with `build-brain.py --single`). It replaces the placeholder. Sources and licence grades are in `docs/demos/brain-torso/v1/NOTICE*.md`. The cortex shapes come from TemplateFlow fsaverage, whose licence is graded Suspected (no licence file found); it is shown for educational use at the owner's direction and may be removed if the rights holder asks.

## v4 (2026-11-07)
- Added the meme wall: eight captioned frames of the demos (`docs/assets/memes/`). Demos unchanged.

## v3 (2026-11-07)
- The v2 adapter fallback did not help on the reporting machine: its `chrome://gpu` (Chrome 156, Intel UHD 620, Windows) lists the Intel adapter under Dawn Info as "Blocklisted - D3D11 backend not fully implemented" and the only other adapters as a blocklisted CPU renderer, so every `requestAdapter()` returns null. The v1/v2 demo pages are unchanged; they cannot run there until Chrome offers an adapter.
- Doc page: when there is no adapter it now explains the blocklist and the one thing to try (`chrome://flags/#enable-unsafe-webgpu`, then relaunch), plus Edge or a Mac. Untested on that machine.

## v2 (2026-11-07)
- Fix: the v1 demo pages gave up with "requestAdapter() returned no adapter" on a machine where a plain `requestAdapter()` works. They asked only for the high-performance hint. The v2 pages try the plain request first, then the hint, low-power and the software adapter. Reproduced in a headless test (v1 shows that exact error when only the plain request answers; v2 loads). Cause on the reporting machine is Likely this, not confirmed.
- Doc page check now runs both requests and shows each result.
- Demos are v2 (`docs/demos/*/v2/`); the v1 pages and doc stay in place.

## v1 (2026-11-07)
- First page. Demos in the order asked for: 1 Collider events (five pages), 2 Heritage facade splats, 3 Torso CT (placeholder).
- Page checks WebGPU in the visitor's own browser and shows the adapter, locally only.
- Sources: x3d.loom PR #12 (`x3d.webgpu/demo/src/build-events.py`, `build-v3.py`). Scene hashes are in `docs/demos/SOURCES.md`.
