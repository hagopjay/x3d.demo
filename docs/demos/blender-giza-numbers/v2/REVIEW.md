# Great Pyramid Numbers: technical and scientific review

Reviewed 19 November 2026 against repository baseline `028f25f475934661bb05c7197d68552a798f6276`.

This document audits the archived **v1** implementation. References such as `index.html:190` are relative to `../v1/`. It records the reasons for the v2 redesign; it is not a claim that every remaining research question has been resolved. Evidence consists of source inspection, independent numerical calculations, primary-source checks, and the startup failure observed during the accompanying live review.

## Overall assessment

The best feature is the shared numerical receipt: both the Blender generator and interface consume the same geometry and claim data. The explicit attention to units, datums, correlated claims, and uncertainty already gives the project a strong educational purpose. The main weaknesses are a broken viewer initialization path, a mismatch between mathematical and historical evidence, unjustified statistical labels, and diagrams whose display offsets exceed the numerical effects under discussion.

The ideal direction is an instrument for investigating a magnificent human engineering achievement: let the visitor manipulate the geometry, compare hypotheses, inspect magnified residuals, and trace every conclusion to its assumptions. Visual richness should expose relationships, rather than imply more measurement precision than exists.

## Findings in v1

| Priority | Finding and source evidence | Consequence and corrective principle |
|---|---|---|
| P0 | `index.html:189–191` appends an `x3d-canvas` and immediately calls `X3D.getBrowser(cv)`. The live page reports that `loadURL` is accessed on `undefined`. | The central scene is unavailable. Wait for the supported X_ITE initialization/custom-element lifecycle before obtaining the browser; show a useful loading/failure state; verify a rendered scene, not only valid XML. |
| P1 | `verify_numbers.py:33–46` uses `BASE_U=0.07`, described as half a spread, and historical slope `±2′` as Gaussian standard deviations. `index.html:168` labels the result “survey ±1σ”. | These are not established survey standard uncertainties. Call this an **assumed sensitivity model**, document the inputs and independence assumption, and reserve “confidence interval” or “1σ survey” for justified statistical quantities. |
| P1 | `verify_numbers.py:110–121` manually grades π “Confirmed”, while its explanation says the builders used 22/7 “by design”; `index.html:74` says the pyramid “knows” the constants. | Numerical compatibility does not establish historical intention. Separate geometric agreement, documentary evidence, and interpretation. A seked of 5½ produces the stated rational ratio mathematically; that identity does not prove a particular motivation for choosing the slope. |
| P1 | `sig_agree` at `verify_numbers.py:49–58` compares independently rounded significant figures, while `index.html:151–159` colors literal digits as if a common prefix had been established. | A rounding agreement is not a literal shared digit string. For example 1080 and 1079.5703 receive four “agreeing” figures despite differing at the third literal digit; 9.99 and 10.01 receive two despite having no leading digit in common. Prefer residuals, relative differences, interval overlap, and explicitly defined rounding comparisons. Never interpret matching digits as evidence of design. |
| P1 | `build_numbers.py:107–108` moves every base-square edge 0.5 m outward. This adds 4 m to its displayed perimeter. | At the model’s dimensions, `4B − 2πH ≈ −0.420 m`. The visibility offset is about 9.5 times the effect being compared and changes its sign. Use exact geometry for measurement; label diagram offsets; display a separate residual microscope with a stated exaggeration factor. |
| P2 | `build_numbers.py:106,117` uses tubes about 1.8–2 m in diameter. The measured-versus-exact-φ apex-height difference is only about 0.207 m at fixed base. | Tube width conceals the difference. Retain legible overlays for orientation and use a numerical/screen-space comparison panel for the discrepancy. Geometry, decorative line width, and magnification need separate meanings. |
| P2 | `verify_numbers.py:91–92` propagates `H_U/BASE` into the height/base ratio although height was calculated using the same base. | The shared base cancels: `H/B = tan(θ)/2`. With the existing assumed inputs, the first-order uncertainty is approximately 0.00076289, compared with the stored 0.00078706. Propagate through the reduced expression or retain covariance explicitly. |
| P2 | `verify_numbers.py:109–120` calculates central values as finite Monte Carlo sample means for functions with closed forms. | Sampling noise adds false specificity: analytic π ratio 3.14016019 differs from stored sample mean 3.14013305. Use analytic central values and derivatives for the default model; use reproducible Monte Carlo to illustrate distribution shape, not to introduce unexplained last digits. |
| P1 | `verify_numbers.py:151–164` combines a mapping-service center, assumed ±5 m accuracy, approximate gallery offsets, and seven-decimal latitude strings. It says one of the latitude lines “must” read the target. | These are illustrative coordinates, not a centimeter survey. A chosen target happens to lie within this modeled extent; the existence of many latitude lines does not force an arbitrary target to occur there. Specify the reference point and datum, separate precision from accuracy, and express comparisons in meters. |
| P2 | `verify_numbers.py:124–150` applies a regional three-parameter datum transformation, then emits seven decimal places without a per-result accuracy field. | Suitable for explaining datum dependence, with its limitations exposed. Prefer measured modern control points for positioning; keep approximate transformations as an experiment. A datum, an ellipsoid, and a full reference-frame realization are related but distinct concepts. |
| P2 | Grades are hand-authored, rather than derived from a documented decision rule (`verify_numbers.py:71–80`). “Under 0.5 mm” is “Confirmed” using a 0.508 mm mean (`102–103`); “about 13 acres” is “Confirmed” despite 14.2 model standard deviations (`93–94`). | Exact equality, approximate wording, upper bounds, definitions, and historical claims require different tests. Show the claim type and a specific interpretation. Keep legacy grades clearly editorial; do not present them as probabilities or uniform statistical results. |
| P2 | The `iau` source at `verify_numbers.py:26` combines nominal solar constants with lunar radii, orbital distances, Earth radius, and rotation periods. | Use separate provenance records. Nominal conversion constants, measured quantities, averages, and variable orbital extrema should not share an implied measurement status. Sun/Moon size and distance coincidences are interesting astronomy, not independent evidence about Giza. |
| P2 | `index.html:187` fetches JSON without checking HTTP status or catching errors; renderer-dependent button handlers are registered only after scene loading (`193–194`). | Missing data can leave an inert interface, and renderer failure disables controls without explanation. Load data and graphics independently, check responses, expose retry/source links, and make numerical content usable when WebGL is unavailable. |
| P2 | `index.html:155–156` clears only a never-assigned timer; each act creates multiple untracked timeouts. No pressed/current state is supplied on the act buttons. | Fast act changes can animate obsolete elements; keyboard/screen-reader users get less state information. Prefer cancellable animation or immediate rendering with reduced-motion support, descriptive accessible controls, and explicit selection states. |
| P2 | `index.html:165–170` clips the pyramid’s latitude extent to a narrower fixed chart domain. | The filled band can appear to show the full base despite truncation. Use a full-extent map, explicit clipping indicators, and a zoomed inset for the gallery and claim point. Label both scales and units. |
| P2 | `receipts/validation.json` reports schema and semantic validation of a particular exported file, plus a browser rig name. | Structural validity does not establish successful viewer startup, scientific validity, or visual correctness. Keep these as distinct verification layers with timestamps, commands, versions, and actual outcomes. |

## Mathematical foundation for interactive experiments

For an ideal square pyramid of base side `B`, face slope `θ`, half-base `a=B/2`, height `H`, and slant height `L`:

```text
H = (B/2) tan(θ)             L = (B/2) sec(θ)
perimeter / (2H) = 4 cot(θ)  perimeter / H = 8 cot(θ)
L / a = sec(θ)              seked in palms = 7 cot(θ)
volume = B²H/3              lateral area = 2BL
```

All three π, τ, and φ comparisons depend on the same slope. Changing the overall scale cannot independently tune these ratios. In particular, τ is exactly twice the π comparison, so it is not a second independent statistical success. At seked 5½, `tan(θ)=14/11`, giving `4 cot(θ)=22/7` and `sec(θ)=√317/11`.

The exact π and exact φ slope hypotheses differ by approximately **0.02668°**. This is less than the archived model’s assumed slope width of **0.03333°**. Those inputs cannot strongly discriminate the hypotheses. Interval overlap demonstrates limited resolving power, not a probability that a hypothesis was intended.

With a small assumed slope standard deviation `uθ` in radians, useful first-order sensitivity expressions are:

```text
u(perimeter/2H) = 4 csc²(θ) uθ
u(perimeter/H)  = 8 csc²(θ) uθ
u(L/a)         = sec(θ) tan(θ) uθ
u(H/B)         = ½ sec²(θ) uθ
```

These equations describe an assumed mathematical error model. They do not establish the distribution of historical survey errors or account for departures from an ideal square, uniform slopes, restoration uncertainty, or systematic errors.

## What the primary-source checks establish

- **Survey geometry:** Dash’s 2015 report gives a 230.363 m mean casing-base side. Its per-side 95% bounds are asymmetric; they are not a single Gaussian ±0.07 m uncertainty. The report describes extrapolated corner positions and limited surviving baseline evidence. A square pyramid is consequently a useful idealization, not a point-for-point survey mesh. [Dash 2015, pp. 8–14](https://www.dashfoundation.org/downloads/archaeology/as-published/AERAGRAM16_2_GDash.pdf).
- **Modern positioning:** AERA’s 2018 survey directly measured WGS84 control station E1 and tied it to the GPMP grid. It provides a stronger route to modern positioning than adopting a generic map center or treating a regional datum transformation as exact. Preserve the distinction between E1, mast position, base center, and gallery midpoint. [Dash 2018, pp. 16–20](https://www.aeraweb.org/wp-content/uploads/2019/10/AG19_1.pdf).
- **Units:** The exact numerical value 299,792,458 belongs to the SI expression of the vacuum speed of light and the definition of the metre. A resemblance between that digit string and a decimal-degree latitude is unit- and representation-dependent. [BIPM: metre](https://www.bipm.org/en/si-base-units/metre).
- **Astronomical constants:** IAU nominal quantities are exact conversion factors, not exact true sizes of the Sun or planets. A zero uncertainty on a nominal conversion does not mean the corresponding celestial object has been measured perfectly. [Prša et al. 2016, IAU Resolution B3](https://arxiv.org/abs/1605.09788).

The review does not independently establish shaft-to-star alignments, an Orion ground-plan intention, the history of a supposed foot inscription, or a lost pyramidion’s dimensions. Keep these as attributed interpretations or unresolved claims until they have their own traceable evidence and reproducible calculations.

## Visual and interaction priorities

| Domain | High-value visual experiment | Honesty constraint |
|---|---|---|
| Metrology | Linked plan, elevation, cross-section, dimension arrows, and ratio residuals. | Use exact model coordinates; label offset lines and magnification. |
| Ancient engineering | Seked slider and 7-palms-per-cubit construction triangle; compare rational slopes. | A later mathematical text demonstrates a method, not direct documentation of Khufu’s design choices. |
| Sensitivity | Sweep slope and base; show uncertainty width, analytic response curves, and correlation. | Distinguish visitor-selected assumptions from published confidence bounds. |
| Geodesy | Move a latitude plane through the base and gallery; compare named reference points. | Datum and transformation accuracy must travel with every coordinate. |
| Construction scale | Volume, mass versus assumed density, idealized course accumulation, and material budget. | Synthetic courses and density assumptions must be identified; 2.3 million blocks is an estimate, not a counted inventory. |
| Light and form | Warm/cool lighting presets, readable material roughness, contour illumination, outline/wireframe and x-ray. | Decorative lighting is an interpretive rendering; do not call an arbitrary directional light a precise ancient solar reconstruction. |
| Astronomy | Angular-size diagram for eclipses, variable orbit ranges, explicit unit conversions. | Keep scale compression visible; do not imply coincidence proves ancient encoding. |
| Evidence navigation | Searchable claim ledger with source links, claim types, formula, units, and limitations. | “Editorial assessment”, “model result”, and “measured input” remain separate fields. |
| Presentation | A curated camera sequence and compact/high-density interface modes. | Respect reduced motion, permit pause, preserve labels at small sizes, and avoid hiding the model behind panels. |

## Further research worth pursuing

1. **A true survey ensemble.** Import the four casing baselines, corner coordinates, confidence windows, and covariance if available. Compare the ideal square with the measured quadrilateral and quantify which conclusions survive changing the reconstruction.
2. **A historical evidence graph.** Link each statement to a publication, page/figure, reference point, datum, equation, uncertainty definition, and evidence status. Model derivations as edges so π/τ/φ share one slope dependency visibly.
3. **A controlled coincidence laboratory.** Let visitors select units, reference points, target constants, and rounding after seeing the data, then explain the selection freedoms. A p-value would require an explicit predeclared null distribution and selection procedure; do not invent one from a digit match.
4. **A measured sky reconstruction.** Add precession, proper motion, observation epoch, refraction, horizon, shaft bends and survey uncertainty before comparing candidate stars. Distinguish a line’s geometric extension from a physically open sightline.
5. **Blender round-trip evidence.** Keep the original Blender-exported scene available, identify any procedural browser enrichment separately, and compare world-space bounds, material properties, named nodes, cameras, and metadata after reimport. A richer browser scene alone does not demonstrate that all features round-tripped through the add-on.
6. **Measured rendering tiers.** Add readable low/medium/high detail modes and publish actual frame-time or FPS observations for named devices and viewport sizes. Separate image quality, geometric fidelity, and archaeological fidelity.

## Acceptance criteria for a reliable release

- The scene visibly renders after fresh navigation and after reload; all default resource URLs resolve.
- Data loading, renderer loading, and WebGL failure each have an intelligible independent outcome.
- Selected overlays, camera changes, x-ray state, and reset work repeatedly without stale state.
- Analytic identities and scale invariance are checked; exported numbers include units and assumption metadata.
- Mobile and keyboard navigation retain every control and prevent horizontal page overflow.
- Reduced-motion mode prevents unsolicited camera motion; animation can always be stopped.
- Experimental diagrams disclose exaggeration, compression, synthetic content, and model assumptions.
- Validation receipts describe tests actually executed, and distinguish static checks from a visual/browser run.
