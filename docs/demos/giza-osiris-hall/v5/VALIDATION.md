# Giza V — validation receipt

Build date: 17 November 2026. Integration base: `94e9b2649d7603877aa5e368a650f402d4955a6e` in `hagopjay/x3d.demo`.

## Completed checks

**69 individual automated cases pass.**

| Area | Cases | What they establish |
| --- | ---: | --- |
| Inherited RF/RC mathematics | 12 | Bounded settings, zero drive, Q/phase, energy-rate balance, static/cyclic strain, leakage and timestep consistency |
| Camera and encounter choreography | 11 | Bounded continuous poses, correct normalized look direction, deterministic seeking, reveal caps and return |
| Tesla/session contracts | 12 | New `giza-tesla/1` roundtrip, Horizon/1 and /2 migration, four wide viewpoints, strict bounded settings, exclusion of live charge and runtime ledgers |
| Tesla reservoir and LC bench | 15 | SI conversions, separate reservoir/secondary capacitances, Q and phase, compressed height independent of power, explicit precharge, finite depletion, source-limited discharge, spill, zero-voltage behavior, conservation and timestep partitioning |
| Application event integration | 7 | Real controller boot and twelve source cards; actual view and layer assignments; reference preset; source removal, 5 kJ depletion and no stale arcs; inherited perspectives and caps; reduced motion and slow-frame timing; empty/held import and safe legacy migrations |
| X3D geometry and reproducibility | 12 | Scene contracts, unique/type-correct DEF/USE, finite geometry and indices, deterministic regeneration, arc endpoints/branches, independent Tesla switches, 26 receiver stations, separate toy-Earth anchor and wide cameras |

Node's runner reports **58 passing entries**, including the enclosing application-event parent: 50 pure-function cases + seven event cases + one parent. Python reports **12 passing cases**. The parent is not counted twice in the 69 individual cases above.

Syntax checks pass for `app.mjs`, `tests/browser-smoke.cjs`, `run.py` and `build_scene.py`. Literal HTML control references, unique IDs, controlled X3D DEF lookups, relative application files, imported modules and the twelve-card evidence schema were checked during integration. Repository patch whitespace and forward application are checked when packaging.

## What event checks mean

`tests/app-events.test.mjs` executes the actual `app.mjs` using DOM and X3D scene **test doubles**, derived from the actual HTML IDs/datasets and generated scene DEF names. It verifies event wiring, numerical state and node-field assignments. It does not establish browser layout, WebGL rendering, X_ITE setter compatibility, sound output, visual quality or measured hardware performance.

## Browser rendering remains unverified

The earlier browser-launch attempt in this workspace was blocked before page load because Chromium could not create a required UNIX socket. An alternate browser surface disallowed local file URLs. This v5 revision has not been rendered in an actual browser here. No screenshot, mobile layout pass, audio check, frame-rate benchmark or end-to-end real-browser success is claimed.

The expanded `tests/browser-smoke.cjs` has passed syntax validation and is supplied for a machine with Playwright and Chromium. It starts a temporary HTTP server and checks the Tesla views/switches, capacitor/source controls, finite-energy depletion, twelve source cards, perspective switching, inherited encounter caps, reduced motion, schema/legacy migration and a 390px viewport. Optional internal screenshots include the Tesla, valley, atmosphere and Earth views. These real-browser assertions are not claimed as passed.

## Interpretation limits

The 50 MV, 10 µF and MW/GW settings are user-rated fictional component scenarios. The initial 12.5 GJ bank is explicitly accounted precharge. The 250 kV reference is a global atmospheric potential context; its local source and capacitance remain bench assumptions. No ionospheric energy harvesting, ancient generator, country-scale transmission efficiency, coupled-coil electromagnetic solution or measured site capacitance is established.

The ionosphere's lower extent is around 48–50 km and varies; the two-mile (3.218688 km) option is a fictional storm canopy. Sky height is logarithmically compressed and the regional map and globe use distinct schematic scales. Capacitor energy is in joules, discharge power in watts and capacitance in farads. Field geometry, persistent channels, machinery, craft and beings remain authored visuals. The new X3D file has not received an official XSD/profile-validator receipt.

## Reproduce

From this `v5` directory:

```bash
node --test tests/*.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
node --check app.mjs
node --check tests/browser-smoke.cjs
python3 -m py_compile run.py build_scene.py
```

On a normal development machine with Playwright and Chromium:

```bash
node tests/browser-smoke.cjs
```

The v5 patch adds only `docs/demos/giza-osiris-hall/v5/`. The portable archive also includes unchanged v3/v4 material and a cumulative v4+v5 patch. No external repository was modified and no remote pull request or deployment was created. GitHub publishing remains unavailable in this environment.
