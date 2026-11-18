# Giza v4 · Horizon Engine

A local X3D proof of concept for exploring a giant resonant-pyramid hypothesis and an imagined journey through the King's Chamber. Three lenses connect a schematic monument, a bounded resonance workbench, and a mythic voyage. The evidence drawer explains what is documented, modelled, hypothesized, or invented.

The creative premise is a pyramid that becomes a resonant instrument and carries the observer into a luminous Duat, either beside a king or through a first-person camera. An ankh and Was-sceptre frame the king's heart and brow. Chamber machinery wakes; cosmic geometry opens onto a celestial craft and a nonhuman presence. This is speculative worldbuilding. The experiment uses simplified educational mathematics; it is not evidence that the Great Pyramid generated electrical power, that Tesla copied it, or that ancient Egyptians travelled through an electromagnetic portal.

## Run

From the repository root, with Python 3 available:

```bash
python3 -m http.server 8800 --directory docs --bind 127.0.0.1
```

Open <http://127.0.0.1:8800/demos/giza-osiris-hall/v4/>. On Windows, `py -3` can replace `python3`. Keep the terminal running. A recent WebGL-capable browser is needed for the X3D view. Use HTTP rather than opening `index.html` directly.

Alternatively, open this `v4` directory and run `python3 run.py --open` (WSL/Linux), or double-click `run.bat` (Windows with Python installed). `run.py` resolves the correct parent directory and serves only on localhost. Use `--port 8801` if port 8800 is occupied.

The runtime is the existing bundled **X_ITE 16.6.0** in `../v3/vendor/`. No npm install, online engine CDN, Blender installation, or external service is required for ordinary use. A portable archive must preserve both `giza-osiris-hall/v4/` and `giza-osiris-hall/v3/vendor/` in that relative layout. Copying `v4/` alone omits its renderer. Serve the parent tree using the same layout when using an extracted archive.

## Explore

- **Archaeology** supplies the monument context and the evidence limits of the schematic reconstruction.
- **Laboratory** exposes a driven oscillator and a dimensionless charge/leakage analogy. Adjust one assumption at a time, remove the drive, and compare the result.
- **Mythic** presents the imagined king, ankh, Was-sceptre, and celestial transition. Its 108-second journey has six phases and a seekable timeline.

The accepted creative direction includes both **Witness** and **First-person** cameras, switchable during the journey. The first-person view hides the king's body to avoid looking through the figure. **Encounter level** selects the maximum reveal: **Geometry**, **Craft**, or **Beings**. The default is **Beings**, allowing all three stages to unfold with the timeline; lowering the setting caps the story's escalation. Ancient machines, craft, and nonhuman figures are authored fiction.

Choose **Visit the encounter** to pause at 90 seconds with the complete reveal. The **Witness / First-person** buttons above the scene, or **V** outside form inputs, switch perspective without seeking. **Space** plays or pauses. The Was is fixed as the story instrument; the earlier Djed/receiver experiments no longer appear as story choices. Reduced motion holds automatic camera travel; selecting a chapter, perspective, or encounter preview explicitly reframes the view. First-person also hides the separate Ka double so it cannot cross the observer's sightline.

Reduced motion freezes automatic camera travel while the journey timeline, controls, and evidence remain available. Play, pause, seek, and restart let the viewer inspect a moment or direct the sequence. Exported sessions use `giza-horizon/2` and include `cameraMode` and `encounterLevel`; the importer continues to accept earlier `giza-horizon/1` sessions.

The visual field geometry is an illustration. It is not a Maxwell solution, a measured EMF distribution, a power meter, or a medical claim. Radio-frequency response, acoustic sound design, and the timeline's slow visual pulses represent different quantities. They must not be interpreted as the same physical frequency.

Read [SPECIFICATION.md](SPECIFICATION.md) for the accepted direction, creative and technical contract, the proposed/built distinction, and acceptance targets. Read [NOTICE.md](NOTICE.md) for provenance and interpretation boundaries. [evidence.json](evidence.json) holds the eight source-backed evidence cards used by the interface.

## Rebuild and check

The generated scene is supplied. Rebuilding is optional and uses the Python standard library. From this `v4/` directory:

```bash
python3 build_scene.py
```

Run the pure JavaScript checks with Node:

```bash
node --test tests/*.mjs
```

Check scene structure and byte-identical regeneration with `python3 -m unittest discover -s tests -p 'test_*.py'`.
For an actual browser smoke test, install Playwright and its Chromium browser in your development environment, then run `node tests/browser-smoke.cjs`. The script starts its own temporary local server. Set `GIZA_SCREENSHOTS=1` to capture internal test images. These optional development dependencies are not needed to run the demo.

These are invocation instructions, not a claim that every acceptance target has passed. Consult the accompanying validation notes or delivered check output for the checks actually completed. XML parsing, deterministic generation, numerical unit checks, and an observed browser render establish different things; none alone establishes archaeological accuracy or an electromagnetic simulation's validity.

See [VALIDATION.md](VALIDATION.md) for this build's completed checks and the unverified browser-rendering scope.

## Files

| File | Role |
| --- | --- |
| `index.html`, `horizon.css`, `app.mjs` | Browser interface, presentation, scene controls, journey state |
| `resonance.mjs` | Pure educational oscillator and dimensionless RC/piezo functions |
| `journey.mjs` | Deterministic witness/first-person poses and staged encounter envelopes |
| `session.mjs` | Bounded schema-2 export/import and schema-1 migration |
| `build_scene.py`, `horizon.x3d` | Procedural geometry source and generated X3D scene |
| `evidence.json` | Evidence tiers, summaries, limits, and source links |
| `tests/` | Numerical and application-contract checks |
| `SPECIFICATION.md` | First-v4 contract and future development targets |
| `NOTICE.md` | Lineage, modelling limits, and third-party dependency notice |

v3 remains a separate Evidence Atlas. v4 reuses its bundled renderer and the practice of explicit evidence labels while concentrating on a new chamber-scale and pyramid-scale experiment. It does not inherit v3's XSD receipt, sky model validation, light-bake receipts, or archaeological measurements as certification of the new scene.
