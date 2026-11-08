# Gobbler — Cabinet of Worlds

A private, local-browser edition of the supplied **Gobbler Worlds Within** collection. The intricate bird, its graph and four nested worlds remain. This edition adds a directed journey, a studio light bake, scoped world residency, real render-frame profiling, and evidence tied to actual files.

## Run

Unzip this entire folder, then run:

```sh
python3 serve.py
```

On Windows, `py serve.py` also works. Open **http://localhost:8777** in a recent Chromium-based browser. From WSL, run the server there and open that URL in Windows. The runtime, fonts, textures and audio are bundled; no package install or CDN is needed to view the demo. Do not open `index.html` as a `file:` URL.

Choose **Begin journey**, or a world card. Drag to navigate and scroll to move closer. **Studio** adjusts resolution, frame ceiling, exposure, metal roughness and the baked reflection. Sound starts only when requested. **M** toggles sound; **U** hides/restores controls; **Escape** stops a flight/journey and closes the studio. The original number and letter shortcuts remain. Shift+T opens the legacy tuning interface.

The default is native resolution without multisampling. Fidelity mode uses 1.5× resolution and 4× MSAA; Economy uses 0.65×. These are explicit user choices, not an unmeasured claim that every machine meets 60 fps. The supplied QA rig uses SwiftShader, not a discrete GPU.

## What changed

- Four shader-expanded ribbon meshes receive explicit tangent bases. This avoids an observed automatic-tangent-generation crash without deleting their intentional zero-area input polygons.
- Six roughness levels of numerically baked GGX-filtered studio radiance, RGBM8 encoding, a brushed surface texture, and gentler glints. This is an authored reflection environment, not real-time reflected scene geometry.
- Warm stone / cool ambient Giza lighting; restrained animated beam colours and much lower per-cone opacity to account for overlapping transparent layers.
- A seven-chapter journey, deliberate dwell/push-in shots, finite-pose guards, cancellation, reduced camera motion, compact world controls and explicit story boundaries.
- One world-loading owner. Two root world groups may be resident; the active world and intended destination stay protected through arrival. Departure uses a 15-second grace period. Load failure has a retry path.
- Exterior render branches are hidden while inside a nested world and restored on return. Their geometry and animation declarations remain in the scene. `?isolate=0` disables this for controlled ablation.
- Binary gzip for the host/graph and negotiated HTTP gzip for textual world assets. Original source files and historical receipts are retained, but the old validator badge is no longer trusted as a current claim.
- Gesture-gated sound, volume, three-note world motifs, oscillator cleanup and suspended-clock recovery.
- Completed-render-frame profiling, optional GPU timer queries, sample counts, setting/visibility invalidation and downloadable runtime receipts.

## Read the evidence

Open **docs/DEBRIEF.html** for the architectural review, witness matrix, limitations, discoveries and foldback guidance. `evidence/build.json` binds the generated scene; `candidate.json` binds executable content; `audit.json` records deterministic controls. `browser.json` records the actual browser witness, including hardware identification and expected fault injection. A hash identifies bytes; it is not an XSD, aesthetic, historical or physical-accuracy certificate.

The output host uses **X3D 4.1 experimental Rendering level 5** for explicit Tangent nodes, on bundled **X_ITE 16.5.1**. Pantheon already uses the experimental GaussianSplats extension. This is not a portable X3D 4.0 conformance claim. Source XML remains in `source/`.

## Rebuild and verify

Rendering requires only Python 3. Rebuilding uses the pinned development dependencies in `requirements-dev.txt`; JavaScript unit checks use Node. Browser checks also require Playwright and a Chromium installation.

```sh
python3 -m pip install -r requirements-dev.txt
python3 tools/build.py
python3 tools/audit.py
python3 tools/release.py
node tests/browser.cjs
python3 tools/release.py --check
```

Set `CHROME_EXECUTABLE` to a Chromium executable if Playwright's browser is not installed. Set `GOBBLER_HARDWARE=1` to let Chromium select the normal graphics path. Set `GOBBLER_CAPTURE_DIR` to a directory **outside this release** only when you want QA screenshots. Browser tests deliberately fail one world request and then recover. Build output is deterministic; browser timing is not.

## Boundaries and rights

The source bundle is an exported deployment, not the complete upstream authoring repository. No original Blender files or full music-generation manifest were supplied. Giza's Hall of Records is fictional. Export-fan and agent choreography are simulations. Pantheon is a 50,058-splat appearance sample. Drillfield imagery and data are attributed to Google. Preserve the original asset notices. The Giza material was described as private in the supplied design notes: this delivery is a private local demo, not a public redistribution licence.

No upstream repository was pushed or published. The upgrade patch applies to the supplied archive's extracted root. The separate Loom foldback patch contains portable rules and controls without the scene assets.
