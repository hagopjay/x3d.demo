# Vortex Reconnection & Sound

Quantized whirlpools in a superfluid: a vortex ring, and two rings that collide, cut and rejoin, sending sound through the fluid. The Gross–Pitaevskii equation is solved on two grids; the page calls the event a reconnection only because the vortex-loop sequence agrees on both, and it meshes every frame's vortex cores itself against the builder's reference.

```bash
python3 -E -s tools/vortex.py          # build both cases (about 16 minutes; exits 1 if any witness is red)
python3 -E -s tools/scene.py           # regenerate scenes/vortex.x3d
python3 serve.py --port 8828           # then open http://127.0.0.1:8828/#reconnection
```

Deep links: `#reconnection/f=18`, `#reconnection/play=1/view=Top`, `#ring/lens=lab`.

- `tools/gp.py`: the split-step solver, ring construction, vortex detection and the exact references; bound by hash in every case manifest
- `tools/vortex.py`: the builder and its witnesses
- `src/nets.js`: a copy of `lib/stemkit/js/nets.js` (a stemkit test keeps them identical)
- `docs/DEBRIEF.md`: what was built, what failed and what it taught; `docs/NUMBERS.md` is generated from the manifests

Case payloads (`cases/*/*.bin`, about 5 MB) are not committed; the builder regenerates them and the manifests carry their hashes.
