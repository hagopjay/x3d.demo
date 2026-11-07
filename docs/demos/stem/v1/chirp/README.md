# Chirp

Two black holes spiral together and you hear them. The orbit is integrated with Newtonian gravity plus the leading radiation-reaction force, held to Peters' exact decay laws and the chirp law, and turned into gravitational waves you can watch spread across the orbital plane and hear at their real pitch.

```bash
python3 -E -s tools/chirp.py           # build the three inspirals (about 2 s; exits 1 if any witness is red)
python3 -E -s tools/scene.py           # regenerate scenes/chirp.x3d
python3 serve.py --port 8826           # then open http://127.0.0.1:8826/#equal
```

Deep links: `#equal/view=Wide/t=0.98`, `#eccentric/play=watch`, `#q4/lens=lab`.

- `tools/inspiral.py`: the integrator and the exact references; bound by hash in every case manifest
- `tools/chirp.py`: the builder, its witnesses and the audio
- `docs/DEBRIEF.md`: what was built, what failed and what it taught; `docs/NUMBERS.md` is generated from the manifests

Case payloads (`cases/*/*.bin`, `*.wav`, about 4 MB) are not committed; the builder regenerates them and the manifests carry their hashes.
