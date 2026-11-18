# Giza V · Earth's Tesla Coil

A local X3D proof of concept in which Giza becomes the crown of an imagined planetary circuit. A compressed sky canopy, sustained-looking luminous arcs, a schematic Nile-region network, and an inspectable energy reservoir connect the giant pyramid to the intimate ankh-and-Was journey in the King's Chamber.

The cinematic premise is authored mythic engineering. The numerical workbench keeps the source, storage, output, and losses visible, so dramatic gigawatt scenes have an explicit energy budget. NASA's atmospheric reference, a global-circuit source card, and a reference preset give the viewer a way to compare the invention with bounded scientific context.

## Run

From the repository root:

```bash
python3 -m http.server 8800 --directory docs --bind 127.0.0.1
```

Open <http://127.0.0.1:8800/demos/giza-osiris-hall/v5/>. Windows can use `py -3` in place of `python3`. Keep the terminal running and use HTTP rather than opening `index.html` directly. The 3D view needs a recent WebGL-capable browser.

Alternatively, open this `v5` directory and run `python3 run.py --open` in WSL/Linux, or double-click `run.bat` on Windows with Python installed. `run.py` serves the correct parent tree on localhost. Use `--port 8801` if 8800 is occupied.

The runtime remains the bundled **X_ITE 16.6.0** in `../v3/vendor/`. Ordinary use needs no npm install, engine CDN, Blender, or external service. The portable **`Giza-V-Earths-Tesla-Coil.zip`** must preserve `giza-osiris-hall/v5/` and `giza-osiris-hall/v3/vendor/` in that relative layout. Copying `v5/` alone omits the renderer. v4 may be included for comparison but is not the runtime dependency.

## The planetary workbench

Choose the mythic preset for the giant imagined machine, or the reference preset for a restrained comparison. Reference mode uses approximately **250 kV** as a global atmospheric-circuit context value; its chosen local circuit components and **1 W bench source** are still assumptions, not measurements of Giza. The hypothetical high-power source in mythic mode is entered explicitly rather than inferred from an atmospheric voltage.

| Control or readout | Interpretation |
| --- | --- |
| Sky height, 3.218688–300 km | Adjustable scenario altitude drawn with explicit vertical compression. The two-mile setting is a fictional **storm canopy**; the 80 km reference is a chosen ionospheric sheet, not a universal lower boundary. |
| Capacitance, µF | Assumed lumped storage component, not measured pyramid/ionosphere capacitance. |
| Rated voltage, MV | Reservoir rating used to calculate capacity; live voltage follows stored energy. |
| Stored energy, GJ | The reservoir's current energy, distinct from capacitance or power. |
| Source, MW | Explicit continuing input to the authored circuit. |
| Arc demand, GW, and duty | Requested output power and its active fraction; actual delivery is limited by available energy. |
| Loss, MW | Entered dissipation in the lumped model. |
| Secondary capacitance, pF; inductance, mH; drive, kHz | Separate rated LC branch and relative response, distinct from the µF energy reservoir and inherited MHz RF model. |
| Supply ledger | Initial precharge, admitted source energy, delivered arc energy, losses, and any overflow/deficit reported by the implementation. |

The mythic default starts precharged: **10 µF at a 50 MV rating stores 12.5 GJ when full**. That initial energy is part of the ledger. Its hypothetical source is **600 MW**; a **1 GW** arc demand at **0.6 duty** requests **600 MW** on average, plus **5 MW** of losses. The reservoir therefore cannot sustain that setting indefinitely. Circuit Run/Hold and Reset/Precharge controls are separate from the story's Play/Pause and Seek controls.

The sky sheet and standing-looking lightning are illustrations, not a plasma, weather, or electrical-breakdown simulation. The regional beacons are a schematic authored network, not GIS, an archaeological power grid, or a report of energy supplied to Upper Egypt. The evidence cards explain why the real global atmospheric circuit does not establish a freely available local gigawatt source.

## The chamber and the journey

The three lenses remain available:

- **Archaeology** supplies monument context and evidence limits.
- **Laboratory** exposes the original RF oscillator and dimensionless RC/piezo analogy alongside the new, separately dimensioned reservoir model.
- **Mythic** presents the king, ankh, Was-sceptre, and 108-second six-phase journey.

**Witness** and **First-person** cameras switch during playback or while paused. First-person hides the king's body and separate Ka double to avoid self-occlusion. **Encounter level** caps the escalation at Geometry, Craft, or Beings; the default Beings permits cosmic geometry, machinery/craft, and the nonhuman encounter.

**Visit the encounter** pauses at 90 seconds with the complete reveal. The perspective buttons, or **V** outside form inputs, switch views without seeking; **Space** plays or pauses. Reduced motion freezes automatic camera travel while the timeline, controls, and evidence remain usable. Explicit chapter, perspective, or encounter-preview actions can reframe the view.

New sessions use **`giza-tesla/1`**, retain the journey settings, and add the `tesla` settings object. Earlier `giza-horizon/1` and `/2` sessions remain importable and start with the new planetary circuit disabled. Session settings do not turn inherited v4 validation receipts into v5 certification.

## Rebuild and check

The generated scene is supplied. Optional rebuild, from this `v5/` directory:

```bash
python3 build_scene.py
```

Development checks:

```bash
node --test tests/*.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

For the optional browser smoke test, install Playwright and Chromium in the development environment, then run `node tests/browser-smoke.cjs`. It starts a temporary local server; `GIZA_SCREENSHOTS=1` requests internal test images. These dependencies are not required for ordinary use.

The commands above are instructions, not reports of passed v5 checks. [VALIDATION.md](VALIDATION.md) records the actual scope and the environment's browser limitation. No new browser render is claimed here. Pure numerical checks, XML parsing, deterministic rebuilding, browser observation, and full X3D validation establish different things; none validates the ancient-power-plant premise.

| File | Role |
| --- | --- |
| `index.html`, `horizon.css`, `app.mjs` | Interface, planetary/chamber integration, scene controls |
| `tesla.mjs` | SI-based lumped LC and reservoir model, bounded settings, authored planetary choreography |
| `resonance.mjs` | Original relative RF response and dimensionless RC/piezo analogy |
| `journey.mjs` | Deterministic dual-viewpoint camera and encounter envelopes |
| `session.mjs` | New session contract and older Horizon-session migration |
| `build_scene.py`, `horizon.x3d` | Procedural scene source and generated X3D |
| `evidence.json` | Twelve evidence cards with sources and limits |
| `SPECIFICATION.md`, `NOTICE.md` | Creative/technical contract and provenance |

v5 preserves v4's accepted Was, dual-camera, reduced-motion, and nonhuman-encounter direction. v3 remains a separate Evidence Atlas, and v4 remains the chamber-focused predecessor. The new planetary scene needs its own validation receipt.
