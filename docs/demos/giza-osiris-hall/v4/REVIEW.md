# Second-pass review · Witness Atlas 4.1

## Outcome

The 16 inherited static camera directions are correct within source-rounding error (worst error under 0.012°), with no unintended roll in their authored frames. The more substantial problems were between views and across independent renderers: target drift during the tour, inherited evidence/section settings, out-of-frame deep geometry, camera resets on appearance changes, and inconsistent lighting.

V4.1 now uses a dedicated runtime and pure presentation mathematics while keeping all v3 scene/data bytes unchanged. No new archaeological geometry or raw scan data is claimed.

## Camera audit

| View | Re-evaluation and resulting behavior |
| --- | --- |
| Overview | Target direction retained; speculative leftovers cleared on entry. |
| Sphinx / sunrise | Authored attention retained; east-light preset remains illustrative, independent of epoch/LST. |
| Osiris side | Target and pivot retained; same source geometry feeds the inset. |
| Chamber B | Close-range camera retained; tour derives gaze from attention target instead of independent orientation interpolation. |
| Depth ruler | Source-quantity view retained; evidence layers re-enabled on entry so prior hidden layers cannot silently empty the view. |
| Seismic anomaly | Target retained; theorized layer re-enabled and speculation cleared. |
| Hall exterior | Deliberately enables the speculative layer; fixed pose remains an artistic view. |
| Hall interior | Same explicit speculative status; target-tracking tour reduces transition attention drift. |
| Khafre deep claim | Metric comparison retained; claim geometry remains speculative. |
| Khufu / Big Void | Speculative leftovers now cleared both on entry and at the corresponding tour cue. |
| Orion | Authored night overlay retained; independent precession rotation interpolation and its existing tests remain unchanged. |
| Overhead perspective | Relabeled honestly: the inherited `V_Top` is a perspective camera, not an orthographic survey. |
| Survey frame | Metric model-datum annotations retained, reset when entering another ordinary view. |
| Depth comparison | Scale theater retained; unlike quantities remain differently sourced. |
| Hall detail | Speculative artistic close-up retained, with its attention target. |
| Osiris section | Cut enabled with the intended Z=-28 datum on entry; inset caption corrected from “plateau section” to Osiris section. |
| Hawara plan | Orthographic frame fits the complete court/pyramid footprint at aspect ratios 0.4, 1 and 2.4. Floors now participate in transparency when the optional lower layout is enabled. |
| Hawara section | Orthographic framing includes all geometry through the deepest wall base at Y=-77.5 for a lower-layout datum of -70. |
| Hawara oblique | Explicit target/pivot and bounding-sphere fit replace an approximate fixed pitch; tested across narrow/wide aspect ratios. |

Per-view reset clears user navigation offsets. Appearance changes update named materials, lights, switches and transforms in place rather than rebuilding cameras. Aspect changes refit orthographic bounds; user navigation stays independent per view. Switching study target intentionally creates the other study's default views.

## Tour and interpolation

The earlier tour independently interpolated position and orientation. A correctly aimed endpoint does not guarantee an aimed intermediate frame: at two reviewed midpoints, its gaze differed from the interpolated attention point by about 51° and 61°.

The revised sampler interpolates both position and target, then derives a normalized X3D axis-angle orientation. Smooth mode uses monotone smoothstep after a brief arrival dwell; linear and cuts modes permit comparison. Tests verify exact endpoints, finite axes, target alignment and no position/target overshoot at sampled times. Reduced motion defaults to cuts.

The inherited tour camera also had X3D's default local `(0,0,10)` position inside its animated parent. V4.1 explicitly zeros this offset before using the authored world positions. Playback owns navigation; stopping restores the selected navigation mode. Scrubbing applies the correct accumulated cues and captions. Starting resets section/survey/scale and transparency, and ordinary view entry hides a scrub-preview caption. Hidden-tab time is excluded so the tour does not skip ahead on return.

Paths remain illustrative. They can pass through rock or geometry and are not collision-certified walking routes. Smoothstep is continuous in position/target with zero endpoint velocity, but it is not an acceleration-continuous spline. No physical travel-speed guarantee is made. This favors no overshoot in confined schematic interiors over spline flourish.

## Lighting

Giza retains the four original baked/authored states. Insets now consume the same displayed baked colours and exposure as the main view, including interrupted transitions. Geometry, sky, fog and sun marker interpolate over 0.5 seconds; reduced motion switches instantly. These are display-space presentation blends between authored presets, not a new GI bake or a physical solar trajectory. The diagnostic inset background is uniformly dark, with fog disabled and background angle cardinality corrected.

Vertex-weighted checks of the stored display RGB values (not rendered pixels, not physical luminance):

| State | Mean weighted RGB | 95th percentile | Fraction of vertices with a channel at 1 |
| --- | ---: | ---: | ---: |
| Sunrise | 0.4983 | 0.5478 | about 0.0002 |
| Midday | 0.6295 | 0.6778 | 0 |
| Afternoon | 0.5885 | 0.6366 | 0 |
| Authored night | 0.1910 | 0.2073 | 0 |

The ground supplies roughly 94% of vertices, so this is a data-integrity/relative-state check, not an image-quality score. The night state remains authored albedo scaling, as stated in the source manifest. Exposure after rendering can still clip; no HDR monitor or GPU result is claimed.

Hawara replaces full diffuse-colour emission with shaded stone, a directional key and a cooler fill. Warm study, low-angle raking and cool night are explicit authored presets. Its water sheet can be hidden. No dynamic shadow-map or physically calibrated material claim is made.

## Features, lifecycle and evidence

- All 14 inherited `LB_*` label switches are suppressed in diagnostic Giza feeds. The raw scene placed labels outside evidence switches; hiding speculative geometry alone did not hide their labels.
- Independent renderers load sequentially. Cancellation is checked after asynchronous boundaries; pending and completed resources are owned by slots. Late loads cannot reattach to a closed/replaced feed. Resource disposal is idempotent and releases the WebGL context when supported.
- Closing VISOR preserves the existing Hawara main view. Reducing the view budget keeps matching cameras. Failed loads report loaded/expected counts and offer retry.
- Hidden extra contexts pause. On mobile, the CSS-hidden Hawara main view pauses; Giza pauses as a backdrop while Hawara is open.
- Escape works while a slider/select/button has focus. Open/close transfers focus. Hawara/VISOR shortcuts are scoped so they cannot start a hidden Giza tour. Inapplicable controls are disabled, with explanatory copy.
- Main reports include Witness settings and effective camera matrices/FOV. Camera notebook/session restoration still covers only the main Giza camera; report matrices are diagnostic records, not a new inset-session import contract.

## Verification and remaining acceptance

Passed: inherited 30 Node + 8 Python tests, 17 new Node tests, two generated-geometry/deployment Python tests, JavaScript syntax, cross-references, frozen scene-byte identity and clean-base patch application: **57 automated tests** in total. These tests sample mathematics and resource lifetime; they do not prove a rendered browser works.

Outstanding: the actual Playwright/WebGL acceptance script, screenshot review, software/hardware GPU visual comparison, context-loss recovery, cross-browser checks and new procedural-scene XSD/semantic certification. The preview browser cannot reach this workspace's HTTP server; local Chromium's IPC socket is restricted. The included `tests/browser.cjs` covers all main view bindings, default evidence reset, tour scrubbing, camera retention, label suppression, keyboard close and narrow-screen overflow when run on a browser-capable host.

The seven Hawara narrative chapters and their source-status distinctions are preserved. This pass reviews implementation; it supplies no new excavation confirmation.
