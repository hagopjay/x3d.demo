# Giza & Hawara — Witness Atlas (v4.1 · second pass)

Two additions to the v3 Evidence Atlas: a Hawara narrative chapter and “Jordi LaForge vision”, a VISOR-inspired bank of live X3D interior views. The character’s canonical name is Geordi La Forge, played by LeVar Burton; the control keeps the requested user-facing name. This is an unofficial artistic reference, with no borrowed show assets or affiliation.

## Run

From the repository root:

```sh
python3 -m http.server 8800 --directory docs
```

Open `http://localhost:8800/demos/giza-osiris-hall/v4/`.

For the standalone download, run `python3 -m http.server 8800` from the extracted `Giza-Witness-Atlas` folder, then open `http://localhost:8800/v4/`. Windows: `py -m http.server 8800` also works.

Keep v3 next to v4: v4 uses an HTML base URL to reuse the frozen renderer, images, star data, source cards and scene. Serve HTTP; browser file URLs do not support the fetch/module workflow. No npm install or network CDN is required to run the demo. Source links require internet.

## Explore

- **Hawara · narrative atlas** opens seven chapters spanning Middle Kingdom context, classical testimony, excavation, geophysics and contemporary claims. Previous/next buttons stop at the ends.
- **Jordi LaForge vision**, or **V** while focus is outside a control, toggles the view bank. Close with × or Escape.
- Choose Giza or Hawara independently of the narrative panel. The above-ground Giza scene remains available behind the insets.
- Giza uses the actual v3 X3D model in separate contexts: Osiris Shaft, Khufu interiors, and a clipped Osiris section. Inset evidence labels are suppressed; their captions describe the visible subject. Speculation and sky are off inside the bank; the main scene keeps its own settings.
- Hawara uses three cameras over the same procedural model recipe: orthographic plan, clipped elevation, and oblique view. Drag each independently. Twelve courts and 120 columns are an invented arrangement prompted by the account, not an excavated architectural plan. Pyramid silhouette and all dimensions are illustrative.
- Magenta lower walls are off by default. Their adjustable elevation (−8 to −70 model metres) illustrates a conjecture; it is not a radar-derived depth. Blue water is a qualitative preservation-risk cue, not a measured water table.
- Shell transparency changes inset pyramid shells / Hawara walls and, when the lower layout is enabled, its court floors. It does not change the main Giza transparency controls.
- One-view mode reduces context count. Narrow screens default to one view; on phones the bank temporarily covers the narrative panel. Background tabs pause the extra renderers; a phone-hidden Hawara main view pauses too. Giza becomes a paused backdrop while Hawara is open. Closing removes and disposes them. Views are loaded sequentially, with stale-load guards.

## What this release does and does not establish

Herodotus distinguishes claimed observation of the upper chambers from hearsay about the lower chambers. His 3,000-room account is not a recovered room inventory. The other three classical references are explicitly a reading trail, not passages independently verified in this pass.

The 2008 project’s geophysical interpretations and the 2026 advocate-reported excavation update have their own labels. This pass did not locate an authoritative 2026 excavation publication establishing depth, stratigraphy or an intact complex. It does not independently verify a Bob Lazar attribution or a metallic object. No actual radar volume, thermal field, OpenCV processing or deep satellite tomography is loaded. The inset scan-line look is a CSS overlay on real X3D model rendering.

Hawara is a separate Faiyum site, not a tunnel extension under Giza. The comparison is an interpretive design narrative: royal monument → multiplied ceremonial courts → classical descriptions → archaeological fragment → modern sensing and media narrative.

## Validation and limits

Run `make check` here for all 57 tests and the inherited byte-identity checks. See `REVIEW.md` for the second-pass findings and remaining acceptance work.

Measured: v3’s 30 Node and 8 Python tests pass, along with its scene-byte receipt and cross-references. V4.1 adds 17 Node camera, interpolation, colour and async-lifecycle tests plus two Python generated-geometry/deployment tests. All 57 pass. Giza’s 16 source camera directions agree with their target points within 0.012°; Hawara’s complete model fits at viewport aspects 0.4, 1 and 2.4, including lower walls at the deepest setting.

**Graphical acceptance remains outstanding.** The local Chromium launch was blocked by host socket permissions; the separate preview browser could not connect to the local server. No screenshot, WebGL performance, context-loss recovery, device-GPU result or new XSD validation is claimed. `node tests/browser.cjs URL` supplies the browser acceptance checks for an environment with Playwright and Chromium. Optional `CHROMIUM_PATH` selects an installed executable.

The original v3 validation receipt applies only to its unchanged scene. V4 now loads its own `giza.js` runtime while retaining frozen v3 data and geometry. New procedural X3D has XML checks, not a fresh X3D schema/semantic certification. The report now includes Witness settings and effective inset camera matrices/FOV. Camera notebook/session restoration still restores the main Giza camera only; it does not restore inset poses. Insets are independent, not camera-registered sensor overlays or a reconstructed archaeological survey. Simultaneous views can be expensive on mobile hardware; use one-view mode.

## Foldback ideas

Treat every inset as a witness with explicit geometry provenance, sensor provenance and spatial registration. A CSS reticle must never become apparent evidence of an instrument measurement. A future real-data adapter should require coordinate reference, survey date, instrument, processing version, uncertainty and data licence before a layer can be marked measured. Compare alternative interpretations of the same volume without inventing a confidence percentage. Preserve “observed / reported / interpreted / imagined” as separate statuses.

## Second-pass controls

Each live view has **Reset**. Appearance controls update named X3D nodes in place, preserving navigation. **Instruments & appearance** collapses to free space. Escape closes VISOR from controls and restores focus to its opener; a second Escape returns from Hawara.

Hawara has authored warm-study, raking-light and cool-night presets, plus a water-plane toggle. Its stone is shaded rather than fully emissive. Giza insets follow the main bake, exposure and quality; their background is kept uniform for diagnostic contrast.

**Tour studio** adds smooth attention tracking with a brief dwell, linear comparison mode, cuts and timeline scrubbing. Reduced motion defaults to cuts. Entering a normal Giza view clears speculative leftovers and restores its intended evidence layers; the named section resets to the intended Z=-28 plane. The tour resets overlays, hides speculation again at Khufu, removes the old default 10 m local camera offset, and preserves elapsed time while the tab is hidden. Free navigation is disabled during playback. Light changes crossfade baked colours, sky, fog and sun marker over 0.5 s (instant with reduced motion). This is presentation interpolation, not a physical sun/illumination simulation.
