# x3d.demo changelog

The demo doc is the page served at the site root. Every version is kept: `docs/versions/vN/index.html` is a frozen snapshot, and `docs/index.html` is a copy of the newest one. Demos are versioned the same way (`docs/demos/<name>/vN/`). Nothing is overwritten; a change makes a new version.

## v7 (2026-11-07)
- Demo 5, STEM studies, now run live: Chirp, Electron Cloud Observatory, Turing Garden, Living Heart, Vortex Reconnection & Sound (`docs/demos/stem/v1/<study>/`). The x3d.STEM repository does not commit the studies' data files, so each study's own builder was run (`python3 -E -s tools/<builder>.py`, numba and numpy, CPU) and its output bundled. Every case: all witnesses green (Vortex 10 and 11, Living Heart 8, 7 and 10, Turing Garden 14, 14, 14, 14 and 12, Chirp and Electron Cloud green). Each page then verified its data against the repository's recorded hashes, and its in-browser meshes against the builder's (41 of 41, 36 of 36, 48 of 48 frames), in a headless browser on a software GPU. Kerr 2 is not hosted (about 330 MB of images); it stays a source link.
- Demo 4, the manifold, is now hosted too (`docs/demos/manifold/v1/`, from the repository's `studies/manifold`; five key files identical by hash to the original site). The debrief's comparison frames and the builders are left out of this copy.
- X_ITE twin of Neural Canvas (`docs/demos/brain-torso-xite/v1/`): the page the WebGPU version was ported from, X_ITE 16.6.0 bundled, same notices. Demo 1 links the collider's X_ITE twin on the dirac Pages site.
- Demos 1 to 3 (WebGPU) unchanged.
- Fix after merge: the X_ITE twin's bundled X_ITE files were left out of the first push by the page's own `.gitignore` (the page worked through its CDN fallback). They are now in `docs/demos/brain-torso-xite/v1/vendor/` and the ignore file is removed from the hosted copy. No page file changed.

## v6 (2026-11-07)
- Demo 4: Manifold of emotion (X3D 4.0, drawn by X_ITE 16.5.1, not WebGPU). It lives on a sibling repository, x3d.STEM, so the doc links out to it and shows a screenshot (`docs/assets/manifold.jpg`, drawn on a software GPU, status strip cropped out). Nothing from it is copied into this repository.
- New STEM shelf: the six x3d.STEM studies (Kerr 2, Turing Garden, Electron Cloud, Chirp, Living Heart, Vortex Reconnection & Sound), linked to their source and evidence in hagopjay/x3d.STEM, not to live pages: their data files are not committed, so the published study pages stop at "could not be shown" (checked in a headless browser, 6 of 6 give 404 on their data files). They can point at live pages once the data is published.
- Demos 1 to 3 unchanged. The lede now says which demos need WebGPU.

## v5 (2026-11-07)
- Demo 3 is now Neural Canvas, the brain and torso CT drawn with Babylon.js on WebGPU through our own X3D reader (built from x3d.loom PR #13 with `build-brain.py --single`). It replaces the placeholder. Sources and licence grades are in `docs/demos/brain-torso/v1/NOTICE*.md`. The cortex shapes come from TemplateFlow fsaverage, whose licence is graded Suspected (no licence file found); it is shown for educational use at the owner's direction and may be removed if the rights holder asks.

## v4 (2026-11-07)
- Added the meme wall: eight captioned frames of the demos (`docs/assets/memes/`). Demos unchanged.

## v3 (2026-11-07)
- The v2 adapter fallback did not help on the reporting machine: its `chrome://gpu` (Chrome 156, Intel UHD 620, Windows) lists the Intel adapter under Dawn Info as "Blocklisted - D3D11 backend not fully implemented" and the only other adapters as a blocklisted CPU renderer, so every `requestAdapter()` returns null. The v1/v2 demo pages are unchanged; they cannot run there until Chrome offers an adapter.
- Doc page: when there is no adapter it now explains the blocklist and the one thing to try (`chrome://flags/#enable-unsafe-webgpu`, then relaunch), plus Edge or a Mac. Untested on that machine.

## v2 (2026-11-07)
- Fix: the v1 demo pages gave up with "requestAdapter() returned no adapter" on a machine where a plain `requestAdapter()` works. They asked only for the high-performance hint. The v2 pages try the plain request first, then the hint, low-power and the software adapter. Reproduced in a headless test (v1 shows that exact error when only the plain request answers; v2 loads). Cause on the reporting machine is Likely this, not confirmed.
- Doc page check now runs both requests and shows each result.
- Demos are v2 (`docs/demos/*/v2/`); the v1 pages and doc stay in place.

## v1 (2026-11-07)
- First page. Demos in the order asked for: 1 Collider events (five pages), 2 Heritage facade splats, 3 Torso CT (placeholder).
- Page checks WebGPU in the visitor's own browser and shows the adapter, locally only.
- Sources: x3d.loom PR #12 (`x3d.webgpu/demo/src/build-events.py`, `build-v3.py`). Scene hashes are in `docs/demos/SOURCES.md`.
