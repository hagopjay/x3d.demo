# x3d.demo changelog

The demo doc is the page served at the site root. Every version is kept: `docs/versions/vN/index.html` is a frozen snapshot, and `docs/index.html` is a copy of the newest one. Demos are versioned the same way (`docs/demos/<name>/vN/`). Nothing is overwritten; a change makes a new version.

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
