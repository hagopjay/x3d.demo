# Living Heart

Electrical waves in heart muscle, from one heartbeat to the spirals behind tachycardia. The Aliev–Panfilov model is solved on a paced strip, a sheet with a spiral, and a ventricle-shaped wall where the spiral becomes a scroll wave; the solver is held to the exact Nagumo front speed, and the page checks every frame it shows against the builder.

```bash
python3 -E -s tools/heart.py           # build the three cases (about 3 minutes; exits 1 if any witness is red)
python3 -E -s tools/scene.py           # regenerate scenes/heart.x3d
python3 serve.py --port 8827           # then open http://127.0.0.1:8827/#heart
```

Deep links: `#spiral/play=1`, `#heart/cut=0.45`, `#paced/lens=lab`.

- `tools/ap.py`: the Aliev–Panfilov solver (numba) and the Nagumo reference; bound by hash in every case manifest
- `tools/heart.py`: the builder and its witnesses
- `src/nets.js`: a copy of `lib/stemkit/js/nets.js` (a stemkit test keeps them identical)
- `docs/DEBRIEF.md`: what was built, what failed and what it taught; `docs/NUMBERS.md` is generated from the manifests

Case payloads (`cases/*/*.bin`) are not committed; the builder regenerates them and the manifests carry their hashes.
