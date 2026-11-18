# Giza IV validation receipt

Build date: 17 November 2026. Integration base: `94e9b2649d7603877aa5e368a650f402d4955a6e` in `hagopjay/x3d.demo`.
Accepted revision: switchable Witness/First-person cameras, fixed Was-sceptre, staged machinery/craft/nonhuman encounter, and schema-2 experiments with legacy migration.

## Completed

**45 individual automated cases passed:**

| Area | Cases | What was checked |
| --- | ---: | --- |
| RF and RC numerical models | 12 | Bounded settings; zero-drive response; Q and phase; supplied/lost rate balance; moisture and loss changes; sweep; static transient/decay; cyclic forcing; disabled coupling; timestep partition; invalid states; deterministic narrative phases |
| Camera and reveal mathematics | 11 | First-person eye placement and return; witness path; finite normalized rotations; correct look directions; continuous position/aim/FOV across phase boundaries; no overshoot; stage envelopes and encounter caps; deterministic seeking; invalid inputs |
| Session contract | 9 | Schema-2 JSON roundtrip; legacy contact/device migration; accepted camera/encounter combinations; bounded values/types; dynamic viewpoint/mode agreement; metadata stripping; canonical timestamps |
| Application event integration | 5 | Actual `app.mjs` boot and evidence loading; midjourney camera switches preserving time; body/Ka hiding and fixed Was; actual scene-switch assignments for every cap; reduced-motion camera hold and explicit reframe; slow-frame timeline accuracy; actual export/import handlers and legacy migration |
| X3D scene structure | 8 | Named-node contracts; unique DEFs/type-matching USEs; finite coordinates and geometry indices/color counts; no external assets; device and hidden-fiction defaults; camera/body controls; craft/encounter anchor separation; byte-identical regeneration |

Node reports 38 passing test entries: 32 pure-function cases, five application-event cases, and the enclosing application-event test. Python reports eight passing scene cases. The enclosing Node entry is not counted twice in the 45 individual cases above.

The application-event tests execute the real application module with DOM and scene **test doubles** derived from the actual HTML IDs/datasets and X3D DEF names. They validate event wiring and state/field assignments. They do not validate browser layout, WebGL, X_ITE setters, rendered images, audio, or actual hardware performance.

Additional checks completed:

- JavaScript syntax for `app.mjs` and `tests/browser-smoke.cjs`.
- Python syntax for `run.py` and `build_scene.py`.
- Eight evidence cards with required IDs, unique HTML IDs, existing relative dependencies, and resolvable literal control references.
- Whitespace checks for the repository patch.

## Browser status: not verified

The initial browser-launch attempt in this workspace exited **before page load** because the execution environment did not permit Chromium to create its required UNIX socket (`process_singleton_posix.cc`, `Operation not permitted`). The alternate browser surface disallowed opening a local file URL. The current revision has not been visually rendered here. No render screenshot, frame-rate measurement, mobile-layout pass, actual audio check, or end-to-end real-browser interaction pass is claimed.

The updated `tests/browser-smoke.cjs` has passed syntax validation and is supplied for a development machine with Playwright and Chromium. It checks the new actual scene nodes; camera switching at 90 seconds; eye framing and body hiding; encounter caps; continuous camera motion and reduced-motion hold; source cards; schema-2 export/import and schema-1 migration; and the 390px layout. Optional internal screenshot capture includes both encounter perspectives. The updated browser cases are not claimed as passed.

## Meaning and limits

The RF curve is an SDOF analogy, the piezo example is a separate dimensionless RC analogy, and the spatial ribbons are authored geometry. Camera and reveal paths are authored fiction. These tests do not establish an ancient generator, measured material coefficients, a surveyed reconstruction, a Tesla replication, or a supernatural event. The new scene has not received an official X3D XSD/profile-validator receipt.

## Reproduce

From this directory:

```bash
node --test tests/*.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
node --check app.mjs
node --check tests/browser-smoke.cjs
python3 -m py_compile run.py build_scene.py
```

On a machine with Playwright and Chromium:

```bash
node tests/browser-smoke.cjs
```

The patch adds only `docs/demos/giza-osiris-hall/v4/`. Existing v3 files are unchanged. Publication and a remote pull request were not performed: the GitHub connection is disabled for this environment and the CLI has no signed-in GitHub host.
