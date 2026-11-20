# Giza Sacred Geometry Atlas: review of v4 and direction for v5

Reviewed on 19 November 2026 against `x3d.demo` commit `8beeb09` (Demo 65 v4). Source references below are relative to the archived `../v4/` folder. This is a source, data and mathematical review of **v4**, not a claim that every finding remains present in v5. The v5 README and verification receipt describe the changes actually implemented and checks actually run.

## Assessment

v4 is a substantial advance. It keeps native X3D geometry, presents a Blender-baked plateau, places the stellar catalogue in a separate scene layer, interpolates a long-term precession model, distinguishes numerical claims from historical interpretations, and links every claim to a stage composition. Its strongest idea is the movement between the monumental view and a small geometric test.

The next advance should make the scene behave as a coherent instrument. A date change must move the star core, halo, constellation line endpoint, label and numerical readout together. A new camera command must supersede an old one cleanly. Extra glow, grids and labels should reveal a relationship and identify its frame and units. Stronger graphics and stronger evidence can reinforce each other.

The main release concerns found here are asynchronous state ownership, inconsistent proper-motion representations, recovery from partial loading failures, accessibility of motion, and language that still treats hand-authored historical grades as certainty. No new v4 startup failure is asserted by this source review.

## Prioritized findings

| Priority | Evidence in v4 | Consequence and corrective action |
|---|---|---|
| P1 | `stage.mjs:53–64` and `flyTo()` replace `S.tween` without settling the previous tween's promise. A zero-second `goto()` also does not clear an existing tween. | Rapid proof changes can leave an old `applyProof()` awaiting forever, or let an older transition overwrite an immediate jump on the next frame. Use one transition owner: settle/cancel the previous operation before every new transition, including immediate jumps. Return an explicit completion/cancellation result. |
| P1 | `atlas.mjs` uses a tour token for waits, but `stopTour()` does not cancel stage motion or pending fades. `applyProof()` and `fadeThrough()` do not share an operation token. | A stopped tour or older click can still change the camera, lighting or caption after a newer action. Gate every asynchronous continuation by the current operation identity. Stop should stop current motion as well as prevent the next tour stop. |
| P1 | `build/build_sky.py:77–87` appends 179 bright-star halo splats after the bright cores; constellation coordinates are separately emitted from J2000 positions. `stage.mjs:158–171` updates only the star-core entries. | Halos and line figures detach from moving stars at ancient dates. Give halos a core-index mapping and constellation endpoints a star-index mapping. Update all representations from the same epoch-resolved positions. |
| P1 | `scheduleMovers()` ignores changes below 25 years, while `starInfo()` calculates a named star at the exact requested year. Sky rotation and numerical readouts update immediately, but positions are delayed by 350 ms. | The picture and readout can describe different epochs, including indefinitely after a small date change. Debouncing can reduce work, but the committed picture must converge to the exact final requested epoch. A pending state should be explicit if updates are deferred. |
| P1 | `atlas.mjs:33` attaches a success callback to `st.skyReady` without a rejection handler. Several UI event handlers await the sky without catching failures. | A failed or malformed sky resource can leave a partially live plateau, loading status and unhandled rejection. Preserve the usable plateau, show an intelligible sky-specific error, disable only sky-dependent actions, and expose retry. Check `response.ok` for required JSON resources. |
| P1 | `atlas.mjs:231` and the final tour caption call the 11 `Designed` claims “surely” intended. The grades come from manually assigned dictionaries in `build/build_atlas.py`. | A useful editorial classification is presented as historical certainty. Call it an editorial assessment or plausible design interpretation; distinguish attested methods, geometric compatibility and direct evidence for a particular monument. Do not turn the tally into a probability or count of proven intentions. |
| P1 | The King's Chamber source grade is `Confirmed (2:1) / Likely (15-20-25)`, but the atlas takes the first word before `/` and displays `Confirmed` alongside the height comparison. | A compound claim's strongest component grade is applied to a different component. Split width:length and height/diagonal relationships into independently described tests, or retain the qualified compound assessment visibly. The height is about 2.4 of the quoted reported errors from the ideal value. |
| P2 | v1 records are copied with their original numerical grades (`build/build_atlas.py:94–98`). Examples include “joints under 0.5 mm” compared with a mean of 0.508 mm, and historical error magnitudes used as if statistically interchangeable. | Archival data is valuable, but inheritance does not revalidate its interpretation. Add evidence status, uncertainty meaning and a claim-specific comparison rule. A mean near a threshold cannot prove that all observations satisfy the threshold. |
| P2 | `atlas.css:212–215` handles reduced motion only in CSS. JavaScript still requests camera tweens, smooth scrolling and a 16-second fly-out. | Reduced-motion users still experience substantial motion. Carry the preference into camera, fade, scrolling and tour logic; use immediate compositions or optional cuts. Keep motion user initiated and cancellable. |
| P2 | `stage.mjs:325–336` always schedules another animation frame and writes sky-camera orientation and position, even when static or the page is hidden. There is no destroy/cleanup API. | Unnecessary CPU/SAI work persists outside active interaction and complicates future embedding. Suspend work when hidden/offscreen, update only changed fields, cap optional overlay work, and provide cleanup for RAF, timers and listeners. Publish real-device measurements separately from software-renderer checks. |
| P2 | Rig label placement draws after eight failed placement attempts; star-label candidates have no full viewport-bound test. Very long rig labels can receive a negative x coordinate on a narrow viewport. | More labels can reduce useful density through clipping or collision. Bound every candidate box, wrap or abbreviate long labels, use leader lines and priority, and expose a readable DOM equivalent for selected objects. Declutter by importance before increasing the label budget. |
| P2 | “Real stars at their true distances” and “the sky Khufu's builders saw” appear in stage copy. The implementation uses HYG catalogue estimates, a selected subset of moving stars, mean precession, linear space motion and artistically sized splats. | The data-driven sky is useful, but it is a model, not an exact reconstruction or distance measurement. Say catalogue positions/distances and identify the epoch model. Splat width and glow are graphic encodings, not stellar angular diameters. |
| P2 | `build/build_sky.py:175` fixes the Sun and Moon glows to the baked lighting directions. The asset metadata explicitly says they are not ephemeris positions. | Keep this correct limitation visible in the interface: baked golden-hour/moonlight states are lighting compositions. Changing the stellar year does not compute the Sun or Moon for an actual historical date. |
| P2 | A `Show in 3D` action selects one of 11 reusable rigs for 63 claims; many claims share the same monument composition. | The stage is explanatory context, not an independent proof of every claim. Show which measurements the rig displays, which numbers were calculated separately, and whether the view is illustrative. Link the equation and source beside the selected claim. |

## Independent numerical probes

The original eight Node tests pass:

```bash
node --test docs/demos/blender-giza-numbers/v4/tests/atlas.test.mjs
```

Those tests check useful mathematical identities, catalogue fields, camera direction, receipt agreement and data integrity. They do not exercise the runtime's actual mover update, halo linkage, constellation update, overlapping transitions, partial resource failures or native reduced-motion behavior. Passing these tests therefore does not contradict the functional findings above.

Using the shipped initial positions and mover velocities, the angle between J2000 and 10,500 BC directions is approximately:

| Star | Angular change from linear catalogue motion alone |
|---|---:|
| Sirius | 4.44° |
| Arcturus | 7.82° |
| Regulus | 0.87° |
| Alnitak | 0.016° |
| Betelgeuse | 0.102° |
| Thuban | 0.205° |

These are not new astronomical observations. They reproduce the application's own linear space-motion model and quantify why the static-halo/line discrepancy matters. Precession is a separate shared rotation and does not remove the angular difference between a moved core and an unmoved annotation.

The reproduction is simply:

```js
const past = moved(initialPosition, catalogueVelocity, -10499);
const cosine = dot(initialPosition, past) /
  (length(initialPosition) * length(past));
const separationDegrees = Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI;
```

Astronomical year −10499 denotes 10,500 BC; year zero denotes 1 BC. Keeping that convention explicit prevents a one-year offset when sharing experiments or comparing receipts.

## Evidence and model interpretation

The historical distinction is essential. The UCL Digital Egypt overview describes the seked method and its compatibility with the Khufu and Khafre slopes, but also explains that surviving written treatment comes from much later mathematical material and that no Old Kingdom written source for the method is available. A later documented method provides a plausible geometric explanation; it does not by itself establish Khufu's exact intended number. [UCL: calculating pyramid angles](https://www.ucl.ac.uk/museums-static/digitalegypt/pyramids/angle.html).

The HYG documentation defines positions at epoch/equinox 2000, distances in parsecs, proper motion and velocity fields, and its missing/dubious-distance sentinel. v4 correctly filters the documented large sentinel value, which is good hygiene. Retaining a valid catalogue entry does not turn its distance into an exact truth. The catalogue license and creator attribution should continue to travel with the redistributed data. [HYG v4.1 field documentation](https://github.com/astronexus/HYG-Database/blob/main/hyg/README.md).

Dash and Paulson's survey describes deriving baseline estimates and error bounds from evidence at the pyramid's periphery. This supports reconstructive measurement, not a perfectly known original square. The ideal envelope and any uncertainty experiment should remain visibly distinct from measured baselines and survey-specific error definitions. [Dash & Paulson, 2015 survey](https://journals.sagepub.com/doi/10.1177/030751331610200114); [AERA survey summary](https://aeraweb.org/the-2015-great-pyramid-survey/).

The precession choice is appropriate to the long time span: a long-term model is preferable to blindly extending a short-interval modern expression. That does not cover proper-motion uncertainties, stellar multiplicity, refraction, local horizon, shaft bends or a historical observation protocol. A numerical crossing date should be a model-dependent geometric solution, not an archaeological date stamp.

## Creative directions with the greatest explanatory value

| Domain | High-impact visual instrument | What it should make explicit |
|---|---|---|
| Celestial navigation | An adjustable horizon ring, cardinal azimuth scale, meridian, celestial equator and pole axis, all driven by the same sky transform. | Which frame each line belongs to; degrees rather than scene metres; horizon and equator are different planes. |
| Angular measurement | Select two key stars and show their great-circle separation, with a linked two-dimensional angular ruler. | Separation is an angle; changing viewing distance or screen field of view is not changing the actual sky angle. |
| Precession | Pole trails and linked Thuban/Polaris separation curves through the selected year. | A drifting pole against moving stars, with one current marker shared by plot and scene. |
| Stellar depth | A controlled parallax/fly-out slider, a simple distance ladder, and an angular-versus-physical constellation comparison. | Catalogue distance uncertainty and the distinction between an apparent pattern and a connected physical structure. |
| Geometric design | A live seked triangle, exact π/φ alternatives, a magnified residual and a linked square/circle comparison. | One slope drives several correlated ratios; line thickness should not be interpreted as error tolerance. |
| Archaeological survey | Measured four-side intervals beside the ideal square, corner directions and orientation residuals. | Reconstruction, uncertainty and an ideal model are separate products. |
| Shafts | A common-year residual panel for all four shaft stars, alongside the existing separate crossing dates. | Independent best dates do not automatically fit a single building date. Azimuth and bends matter as well as altitude. |
| Evidence navigation | A compact selected-claim inspector with equation, units, dependency links, source/page and evidence status. | Two linked claims are not two independent successes; a source citation is different from source verification. |
| Construction scale | Volume by height, material assumptions and human references. | Illustrative blocks/courses and density estimates should not resemble a measured block inventory. |
| Presentation | A cinematic mode with restrained labels and an instrument mode with grids, scales, tables and residuals. | Density is selected deliberately, while the viewer keeps a reliable home, reset and motion stop. |

These additions should remain native X3D geometry where they occupy the scene. SVG/HTML is well suited to exact plots, controls and readable source text. A luminous grid is most valuable when its labels, units and dependencies are correct.

## Suggested verification gates

1. A selected epoch updates star cores, halo centres, constellation endpoints, labels and numerical readouts coherently, including changes of less than 25 years and returning to J2000.
2. A rapid A→B→C proof sequence settles every pending operation and leaves only C in control. Immediate jumps, Stop, Home and user drags cancel earlier ownership consistently.
3. Plateau and sky failures are tested separately; either usable part stays usable, and rejected promises have a visible, bounded outcome.
4. Reduced motion changes actual JavaScript behavior, not only CSS. Hidden tabs and offscreen stages stop optional work.
5. Label bounds and collisions are tested at narrow widths and maximum density. No label budget is advertised as a guarantee that every name is simultaneously readable.
6. Pure math tests compare against independent analytical cases. Runtime tests exercise SAI writes and asynchronous ownership. Browser checks inspect real pixels, layout, requests and console output. These remain separate claims of verification.
7. Grading is documented as editorial where appropriate. Historical intent has its own evidence field, rather than being inferred from the number of matching digits or a tally label.

The review's source inspection and calculations do not independently validate every historical claim, reconstruct a dated apparent sky, repeat Blender bakes, benchmark a real GPU or establish phone/Firefox/Safari behavior. Those remain separately measurable release work.
