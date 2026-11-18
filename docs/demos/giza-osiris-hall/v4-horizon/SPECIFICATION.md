# Giza v4 · Horizon Engine

## Intent

Build an instrument the visitor can enter: a schematic Great Pyramid becomes a giant resonant object; its layered materials, imagined conductive paths, water, and quartz can be examined; the view then moves into a king's chamber where an ankh and a Was-sceptre become the focus of a luminous journey. Wonder should come from both the experiment and the imagined experience.

The first v4 is a **working bounded proof of concept** with a strict distinction between an archaeological statement, a mathematical analogy, an unverified engineering hypothesis, and story invention. The same geometry can participate in several lenses, but its evidence status must remain visible and understandable. A dramatic rendering cannot upgrade a hypothesis into a finding.

## Creative direction

The visual identity combines near-black basalt tones, warm limestone, dark red granite, electrum-like gold, oxidized copper, deep lapis blue, and a narrow cyan-white excitation palette. Use strong silhouettes, clearly separated depth layers, and an inhabited central chamber. Ornament should reveal a story or a controllable parameter rather than simply fill the screen.

The pyramid acts as an instrument in the story: inundation is its breath, stone is its tension, chambers are its intervals, and the ankh is its key. These metaphors are not physical derivations. A king's figure gives the scale and emotional centre. A visible ankh near the heart and a Was-sceptre near the head connect the intimate scene to the monumental machine. The Was's symbolic association with dominion informs the story; its luminous coupling is an invention. The visitor can accompany the king or enter a first-person perspective.

The story now deliberately reveals all three scales of encounter: celestial geometry, ancient machines and craft, and a nonhuman presence. These are escalating authored images rather than escalating evidence. Keep the Egyptian human and cultural context intact in every interpretation.

## Accepted direction

The user's answers resolve and supersede the earlier open questions about viewpoint, the second device, and alien explicitness:

| Decision | Accepted contract |
| --- | --- |
| Camera | **Witness** and **First-person** are both available, with switching during playback or at a paused/seeked time. The switch uses the current journey time rather than restarting the story. |
| Device | The second object is the **Was-sceptre**. The standard story has ankh and Was only; no device-choice menu offers alternative interpretations. Any legacy exporter/mesh variants are not the selected story. |
| Encounter | Geometry, ancient machinery/craft, and a nonhuman encounter form a staged escalation. A selectable maximum `encounterLevel` of `geometry`, `craft`, or `beings` caps the reveal; the default is `beings`. |
| First-person body | Hide the king's body while using the first-person journey camera, avoiding self-occlusion. Restore the appropriate body visibility in Witness mode. |
| Reduced motion | Freeze automatic camera movement while retaining timeline progression, seeking, interface controls, and evidence access. Suppress avoidable motion effects without making the narrative or sources inaccessible. |

This section records accepted design decisions. Actual browser behavior must still be checked and reported in the build's validation receipt.

## Three lenses

| Lens | Visitor's question | Visual emphasis | Interpretation contract |
| --- | --- | --- | --- |
| Archaeology | What is the object, and what supports the claim? | Monument silhouette, schematic chamber, material context, source cards | Documented materials and context are bounded claims; geometry remains approximate. Hypothetical quartz beds and continuous metal paths are identified as additions. |
| Laboratory | What changes when I alter one assumption? | Section view, relative response curve, illustrative modes, charge/leakage trace | Show inputs, normalized outputs, and model limits. Use source removal and damping comparisons. No measured field or power claim. |
| Mythic | What would the imagined journey feel like? | King, ankh, Was-sceptre, chamber transformation, cosmic geometry, machines/craft, nonhuman encounter | State that the event is fictional. The artistic journey may respond to the lab state without implying that the lab verifies it. |

Lenses change interpretation and emphasis; they do not change historical truth. A compact lens/evidence label should survive panel closing and presentation mode. Source cards remain accessible without leaving the experience.

## Proposed experience and bounded first build

This table defines implementation scope. **“First-build contract” is a requirement, not a receipt of completed testing.** The integrator records actual results separately after running the software. Broader proposals are deliberately outside this first bounded implementation.

| Area | First-build contract | Proposed later expansion |
| --- | --- | --- |
| Scene | Procedural `horizon.x3d`: pyramid context, schematic King's Chamber, king, ankh, Was-sceptre, illustrative quartz and conductive paths, field/celestial forms, fictional machinery/craft/nonhuman figures | Survey-anchored architecture, photogrammetry, measured material assignments, multiple chambers and shafts |
| Rendering | Existing locally bundled X_ITE 16.6.0; controllable layered scene and legible cameras | New validated renderer features, baked physically based lighting, measured quality tiers, immersive XR |
| RF explanation | Pure JS driven single-degree-of-freedom response, relative detuning/damping comparison | External full-wave solver adapter, actual mesh/material boundary conditions, imported field samples and convergence receipts |
| Piezo explanation | Dimensionless RC/change-of-force illustration; static loading and leakage concept | Coupled mechanical/electrical constitutive model with justified geometry, tensors, electrodes, losses and energy accounting |
| Water | Controllable scenario/visual input with explicit limits | Independent historical landscape reconstruction and hydrogeological model |
| Materials | Visual or scenario controls clearly separated from measured physical parameters | Frequency-dependent conductivity, complex permittivity, loss tangent, anisotropy and calibrated material data |
| Journey | Deterministic 108-second six-phase story with play, pause, seek, restart, switchable Witness/First-person cameras, staged encounter with selectable maximum, and reduced-motion camera freeze | Branching narrative, improved visitor embodiment, alternative king poses, user-defined scenes and director tools |
| Audio | If included, opt-in human-audible sonification with a clear mapping | Spatial sound, designed score, accessible captions and multiple audio mappings |
| Evidence | Eight cards with explicit tiers, sources, and limits | Versioned claim graph and per-geometry source links inherited from the broader flywheel work |
| Portability | Static files; HTTP from `docs`; preserve sibling v3 renderer layout | Self-contained deployment packaging and automated archive verification |

## Technical architecture

| Module | Responsibility | Boundaries |
| --- | --- | --- |
| `build_scene.py` | Deterministically emit procedural `horizon.x3d` using the Python standard library | No hidden network calls, physics inference, Blender dependency, or validation claim from generation alone |
| `horizon.x3d` | Declarative, inspectable X3D scene with stable control nodes, named viewpoints, bounded geometry counts | Approximate architecture; visible field geometry is illustrative |
| `resonance.mjs` | Pure numerical functions for oscillator response, charge/leakage analogy, phase sampling and input normalization as needed | No DOM or X_ITE dependency; no full-wave solver; no uncalibrated SI output |
| `journey.mjs` | Pure deterministic camera and reveal mathematics derived from absolute journey time and accepted camera/encounter settings | Authored choreography, not a physical trajectory or an archaeological reconstruction |
| `session.mjs` | Strict schema-2 session contract and schema-1 migration, preserving camera and encounter choices | Reject nonfinite values and unknown modes; do not restore audio, playback or transient voltage |
| `app.mjs` | UI state, evidence loading, X_ITE scene access, lab controls, timeline and camera/choreography integration | Separate narrative state from model outputs; surface initialization failure rather than pretending the scene is ready |
| `index.html`, `horizon.css` | Accessible static interface and responsive presentation | Clear model/evidence labels, visible control labels, readable small-screen layout |
| `evidence.json` | Source-backed claims and interpretation limits | Array of eight entries; links do not certify the application |
| `tests/` | Pure numerical and scene/application contracts | Checks report what they establish; no transitive archaeological or physical certification |

Use JavaScript modules served over HTTP. The scene loads the existing renderer from `../v3/vendor/`, whose shipped version is 16.6.0. A portable archive preserves this relative relationship; it must not require an engine CDN to launch. References to v3 receipts, data, or appearances must retain their original scope.

Use stable X3D DEF names for every node controlled by the page. Keep expensive geometry generation outside the animation loop. A page-level controller should update a bounded number of transforms, materials, switches, or coordinates. Avoid per-frame DOM reconstruction and unbounded allocations. Browser rendering must remain the principal acceptance observation; a successful generator is insufficient.

The generated encounter groups expose `SW_MACHINERY`, `SW_CRAFT`, and `SW_BEINGS`. The page combines deterministic reveal envelopes with the selected maximum encounter level: `geometry` suppresses the machine/craft/being additions, `craft` permits machinery and craft, and `beings` permits every stage. A group whose cap excludes it must remain hidden when seeking directly into its usual reveal interval. Story settings do not alter laboratory energy calculations or evidence tiers.

The frame is a local scene convention with +Y up and metre-like architectural dimensions. It is not a geodetic survey frame. Display external architectural dimensions as approximate when used; never imply that an invented relative placement is a measured datum. Any inherited v3 East/Up/South convention must be preserved explicitly if the two scenes are later combined.

## Mathematical contracts

### Relative driven response

For a teaching oscillator with drive frequency ratio \(r=f/f_0\) and quality factor \(Q>0\), the conventional displacement magnification is

\[
M(r,Q)=\frac{1}{\sqrt{(1-r^2)^2+(r/Q)^2}}.
\]

An implementation may normalize this further for bounded display, but it must document that normalization. At \(r=1\), this expression is \(Q\); the precise peak can shift with damping. Avoid claiming that the damped peak is always exactly at \(f_0\). A source amplitude of zero must yield zero driven output, including at a resonance. The display may clamp graphical brightness without silently altering the underlying numerical result.

The prototype may use a reference frequency within the 0.50–1.50 MHz interval associated with the published paper's wavelength range. That reference is a scenario value, not a calculated eigenfrequency of this particular mesh. A curve from this equation does not establish a pyramid mode or validate the 2018 results. Real RF predictions require Maxwell's equations, geometry, material properties, boundary conditions, source specification, and solver convergence.

### Dimensionless charge/leakage analogy

The physical circuit analogy motivating the display is

\[
C\frac{dV}{dt}+\frac{V}{R}=d_{\mathrm{eff}}\frac{dF}{dt}.
\]

The first prototype uses normalized force, time, charge, and leakage variables. It should expose a bounded static-load step and/or a periodic change-of-force demonstration. Once the force stops changing, the source term becomes zero; a finite leakage path causes an exponential decay. An ideal zero-leakage capacitor can retain charge, but delivering energy to a connected load changes that condition. Sustained extracted power cannot be inferred from stone mass.

Do not label normalized voltage as volts or normalized power as watts. Crystal fraction and alignment are scenario assumptions, not a site measurement. Random orientations need not sum coherently. A macro-scale quartz-rich rock cannot be treated as one perfectly aligned piezoelectric crystal. No direct conversion from seasonal flooding to MHz drive is established.

The proposed 100,000 stones at two **metric tonnes** each give a 200,000,000 kg scenario. If a different ton convention is selected, the conversion changes. That scenario is separate from the actual pyramid's total mass. Contact area, stress tensor, load-bearing paths, elastic compliance, quartz fabric, electrodes, capacitance, leakage, and continuing mechanical work remain necessary for a quantitative model.

### Frequency and energy language

| Quantity | Permitted first-v4 interpretation |
| --- | --- |
| RF frequency | A lab scenario input for a simplified response curve |
| Visible field pulse | Slow artistic depiction of phase/amplitude; time-compressed and not literal MHz animation |
| Audible tone | Human-audible mapping or composition; not RF made directly audible |
| Seasonal flood control | Scenario and visual parameter; not a solved groundwater boundary condition |
| Resonance amplitude | Relative response under an external drive; not energy creation |
| Brightness/coherence | Presentation or narrative variable; not consciousness, measured field, or biological effect |

Keep independent source terms separate. The reference RF source, hypothesized hydraulic/strain input, and artistic narrative excitation must not be added as if they had common physical units. Report no efficiency until input work and output energy are defined and conserved in a validated coupled model.

## The 108-second voyage

Six equal 18-second phases create a first directable story. Names below are creative targets; UI names may vary if timing and meaning remain clear. The timeline must derive its current phase and visual state from absolute journey time, so seeking and replaying do not depend on the path taken to reach a moment.

| Time | Phase target | Creative action | Meaning boundary |
| --- | --- | --- | --- |
| 0–18 s | Inundation | Water and distant horizon awaken; pyramid scale is established | A fictional seasonal awakening, not evidence of a hydraulic engine |
| 18–36 s | Compression | Stone, invented quartz, and imagined pathways become readable | Mechanical pressure is a hypothesis cue, not a source of endless current |
| 36–54 s | Attunement | Chamber rhythm and ankh respond; the observer approaches the king | A visual mapping of tuned response, not a measured chamber field |
| 54–72 s | The Heart Gate | Light connects heart, ankh, and Was-sceptre; chamber opens symbolically into invented machinery | Entire transition and the devices' active functions are invented |
| 72–90 s | Duat Transit | Celestial geometry yields to ancient craft and a nonhuman encounter, subject to the selected maximum reveal | An authored divine/cosmic journey; no teleportation or alien-discovery claim |
| 90–108 s | Return to the Horizon | Light resolves into the pyramid and the visitor regains the workbench | A return to inquiry, with source and assumption access retained |

**Playback contract:** Play resumes from the current time; Pause stops time advancement; Seek sets a clamped time from 0 to 108 seconds; Restart returns to the beginning with a clear play state; completion remains stable at 108 seconds until explicitly replayed. An implementation that loops should label the loop and make it optional. Lens changes must not accidentally create competing animation loops. Audio, when present, starts only after an appropriate user gesture and can be stopped independently.

**Camera contract:** `cameraMode` is `witness` or `first-person`. Both sample choreography from the current absolute journey time. Switching midjourney or while paused must preserve that time, current phase, selected encounter cap, and lab assumptions. Witness mode offers an external view of the king and environment; first-person mode follows the authored embodied route with the king's body hidden. Avoid duplicate animation loops or a delayed named-view transition overwriting a manually switched journey camera. `journey.mjs` supplies the pure camera/reveal calculations; `app.mjs` applies them to X3D state.

**Reduced-motion contract:** Automatic camera travel freezes while the setting is active; the timeline, phase captions, seek controls, encounter cap, and evidence remain functional. The setting does not erase progress or force the user to leave the story. Check camera pose stability over multiple advancing frames; a paused visual pose must not be confused with a paused timeline.

Avoid global flashing. Favor smooth envelopes, material fades, and spatial movement over strobing. The most intense passage should retain a legible focal point rather than saturate the entire frame.

## Session compatibility

New session exports identify schema **`giza-horizon/2`** and include `cameraMode` and `encounterLevel` with their accepted enum values. The importer accepts both `/1` and `/2`; older sessions lacking the new fields receive documented defaults rather than failing solely because they predate these controls. All supplied values still require validation. Unknown schema identifiers or invalid camera/encounter values must produce a useful error without partially applying a session. The new schema does not upgrade evidence status, certify a camera render, or imply a physically coupled experiment.

## Evidence data contract

`evidence.json` is an array whose objects have this exact required structure:

```json
{
  "id": "resonance",
  "title": "A bounded title",
  "tier": "model",
  "summary": "What the source or story actually supports.",
  "limit": "What this does not establish and where the prototype differs.",
  "sources": [{"label": "Human-readable source", "url": "https://example.org/"}]
}
```

Allowed tiers are `documented`, `model`, `hypothesis`, and `fiction`. Required unique IDs are `resonance`, `nile`, `stone`, `quartz`, `metal`, `tesla`, `ritual`, and `aliens`. A documented card may explicitly identify a separate unsupported extension; tier describes the card's principal anchored subject and must not imply endorsement of that extension. Interface wording should show both summary and limit. Links open with appropriate external-link behavior and must not execute HTML from JSON.

The foundation quartz bed and continuous conductive lining are unsupported site configurations in this edition. Egyptian divine imagery is historically attested as imagery, while the exact enacted story is fiction. The selected ritual museum examples may be later than Khufu; they inform artistic language rather than supply a reconstruction reference for the King's Chamber.

## Acceptance criteria and evidence of completion

Every item below begins as **TARGET**. The implementation owner records the exact command or observation, result, date, and limitation before calling it **PASS**. A desired feature is not a completed check. “Not checked” is an acceptable honest receipt, but it cannot be presented as a passed requirement.

| ID | State | Acceptance target | Useful verification |
| --- | --- | --- | --- |
| A01 | TARGET | Root-of-`docs` local server launches the page with its sibling v3 runtime; no engine CDN is required | Observe page/network loading from the documented URL and portable archive layout |
| A02 | TARGET | Scene renders a recognizable pyramid, inhabited chamber, ankh, Was-sceptre, and the selected celestial/machine/craft/being passage | Observe browser and named views; capture internal review images if helpful |
| A03 | TARGET | Three lenses update the intended view/emphasis and retain an interpretation label | Exercise all lenses in a browser |
| A04 | TARGET | Evidence cards expose eight required IDs, tier, summary, limits, and working source links | Parse JSON and inspect evidence UI |
| A05 | TARGET | Generator is deterministic for identical inputs; scene is well-formed XML | Regenerate in temporary files, compare hashes, parse XML |
| A06 | TARGET | Controlled DEF references exist and are unique; geometry values and transforms are finite | Structural scene test and application lookup check |
| A07 | TARGET | Pure oscillator response remains finite for permitted input; detuning/damping behave as documented | Node numerical tests including limits and invalid inputs |
| A08 | TARGET | Zero external drive gives zero driven response; no UI value labels that as generated power | Numerical test plus UI text review |
| A09 | TARGET | Dimensionless RC demonstration decays after a load step and distinguishes changing force from static preload | Pure tests of decay, periodic input, zero coupling, and finite values |
| A10 | TARGET | Six-phase journey spans exactly 108 seconds and seeks deterministically | Boundary/sample tests, then browser play/pause/seek/restart checks |
| A11 | TARGET | Pause does not advance time; end state and resume/restart are coherent | Browser observation with repeated controls |
| A12 | TARGET | Scene remains interactive during laboratory and journey updates; work stays bounded | Observe representative session and report browser/device; record frame timing if measured |
| A13 | TARGET | Keyboard focus, labelled ranges/buttons, small-screen layout, and failure messaging remain usable | Keyboard and narrow-viewport browser checks |
| A14 | TARGET | Optional audio requires user gesture, can be muted, and is described as sonification | Browser audio-control check if audio is included |
| A15 | TARGET | Copy and documentation do not assert quartz foundations, continuous metal lining, Tesla replication, or alien authorship as established facts | Review all visible labels and evidence cards |
| A16 | TARGET | All unit/structural checks required by this implementation pass | Record actual commands, counts, results, and unresolved failures |
| A17 | TARGET | Any XSD/semantic validation uses this new scene's bytes and records validator/version/hash | Separate optional validator receipt; do not reuse v3's |
| A18 | TARGET | Witness/First-person switching preserves journey time during playback, pause, and after seeking | Pure camera samples plus browser control/pose observations |
| A19 | TARGET | First-person view hides the king's body and Witness restores the correct body state | Structural visibility contract and browser self-occlusion check |
| A20 | TARGET | Encounter maximum gates geometry, machinery/craft, and beings consistently at every sampled time; default `beings` permits all stages | Pure cap tests, scene switch checks, browser seek checks |
| A21 | TARGET | Reduced motion holds automatic camera pose while the timeline and evidence remain usable | Browser pose comparison across advancing frames and controls |
| A22 | TARGET | `/2` session roundtrip retains both new settings, `/1` sessions import, and invalid data is rejected before mutation | Session validation tests plus UI import/export observation |

An observed browser render plus passing pure numerical tests is the minimum credible first prototype. Full-wave physics validation, historical reconstruction accuracy, performance guarantees on untested hardware, and a full X3D conformance receipt remain separate work unless actually performed and documented.

## Experiments that teach something

1. **Remove the source.** Tune the oscillator, then set the external drive to zero. Distinguish an object's capacity to resonate from a source that supplies energy.
2. **Add loss.** Compare low and high damping without changing the source. Observe the response curve instead of relying on brightness alone.
3. **Load and wait.** Apply the normalized static-load step. Watch a charge response decay through leakage. Contrast that with periodic changing force.
4. **Remove the invented bed.** Reduce coupling or quartz contribution to zero. This tests a model assumption; it does not conduct an archaeological survey.
5. **Compare interpretations.** Revisit the same scene in Archaeology, Laboratory, and Mythic. Identify which statements concern an object, an equation, and a story.
6. **Direct the journey.** Seek to the heart-gate moment, inspect it, return to the beginning, and replay. The narrative remains available for creative direction without disguising its invented status.

## Accepted direction replaces the initial questions

The viewpoint, second-device, and alien-explicitness questions are answered in **Accepted direction** above. They are no longer pending choices: both camera modes, the Was-sceptre, and all three encounter stages are in scope. Subsequent creative work can refine the king's gesture, machine/craft language, nonhuman design, and choreography without reopening those decisions or treating the authored imagery as historical evidence.

## Next technically credible expansion

After the first build's actual checks pass, choose one deeper physical question rather than increasing apparent certainty through decoration. A useful next slice imports externally computed field samples for one well-defined dielectric pyramid and compares them with an equal-volume control shape. Record mesh, boundary conditions, source polarization, permittivity/loss, solver settings, convergence, and energy balance. Keep this result separate from the artistic field layer and from a claim about what ancient builders intended.

In parallel, the creative slice can improve the king's gesture, chamber materials, camera blocking, ankh geometry, score, and journey staging. Both tracks improve the experience when the interface lets the visitor see which track each improvement belongs to.
