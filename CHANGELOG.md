# x3d.demo changelog

The demo doc is the page served at the site root. Every version is kept: `docs/versions/vN/index.html` is a frozen snapshot, and `docs/index.html` is a copy of the newest one. Demos are versioned the same way (`docs/demos/<name>/vN/`). Nothing is overwritten; a change makes a new version.

## v1 (2026-11-07)
- First page. Demos in the order asked for: 1 Collider events (five pages), 2 Heritage facade splats, 3 Torso CT (placeholder).
- Page checks WebGPU in the visitor's own browser and shows the adapter, locally only.
- Sources: x3d.loom PR #12 (`x3d.webgpu/demo/src/build-events.py`, `build-v3.py`). Scene hashes are in `docs/demos/SOURCES.md`.
