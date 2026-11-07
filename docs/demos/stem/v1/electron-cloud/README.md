# Electron Cloud Observatory

Hydrogen, solved numerically and held to the exact answers: ten orbitals from 1s to 5g, and Lyman-α, a superposition whose charge swings through the nucleus at the frequency of hydrogen's brightest ultraviolet line. The page meshes every verified field itself, checks its mesh against the builder's, colours the skin by the sign of the wave, and plays the superposition through X3D's own event graph.

```bash
python3 -E -s tools/cloud.py           # build all eleven states (about 15 s; exits 1 if any witness is red)
python3 -E -s tools/scene.py           # regenerate scenes/cloud.x3d
python3 serve.py --port 8825           # then open http://127.0.0.1:8825/#4fxyz
```

Deep links: `#lyman/f=0/play=1`, `#3s/cut=0.5`, `#4fz3/share=0.99/lens=lab`.

- `tools/radial.py`: the radial solver and the exact references it is held to; bound by hash in every case manifest
- `tools/cloud.py`: the builder and its witnesses
- `src/nets.js`: a copy of `lib/stemkit/js/nets.js` (a stemkit test keeps them identical)
- `docs/DEBRIEF.md`: what was built, what failed and what it taught; `docs/NUMBERS.md` is generated from the manifests

Case payloads (`cases/*/*.bin`, about 7 MB) are not committed; the builder regenerates them and the manifests carry their hashes.
