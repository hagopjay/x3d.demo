# Turing Garden

Five gardens grown by one pair of equations. Gray–Scott reaction–diffusion runs in a periodic 64³ box from three random seeds, and each garden differs only in the feed and removal rates. The page meshes every computed state in your browser, checks that mesh against the builder's own, and plays the growth through X3D's own event graph.

```bash
python3 -E -s tools/garden.py          # build all five gardens (about 2 minutes; exits 1 if any witness is red)
python3 -E -s tools/scene.py           # regenerate scenes/garden.x3d
python3 serve.py --port 8824           # then open http://127.0.0.1:8824/#coral
```

Deep links name a whole view: `#spots/f=0/play=1`, `#coral/f=12/cut=0.55`, `#sheets/iso=0.25/lens=lab`.

- `tools/gs.py`: the solver (numba, 7-point Laplacian, forward Euler); bound by hash in every case manifest
- `tools/garden.py`: the builder and its witnesses
- `src/nets.js`: the browser's port of `lib/stemkit/mesh.py`
- `docs/DEBRIEF.md`: what was built, what failed and what it taught; `docs/NUMBERS.md` is generated from the manifests

Case payloads (`cases/*/v*.bin`, about 43 MB) are not committed; the builder regenerates them bit for bit and the manifests carry their hashes.
