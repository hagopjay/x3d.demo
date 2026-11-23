# G4 bake runbook: Blenderizer visual upgrades for x3d.demo

The heavy part of each upgrade is a Cycles bake: Blender lights procedural materials and bakes the light into image
textures, which x3d-blender-io exports as X3D 4.0 (UnlitMaterial + emissiveTexture). On the 8 GB M3 the bake runs at
about 10 M samples/s, and Metal is no faster than the CPU for bakes (26.5 s Metal vs 23.5 s CPU for a 1024 px,
256-sample bake, measured 2026-11-22). So the Mac does look-dev (`quick`) and a budget build (`local`), and the
final-quality bakes (`g4`) run on the leased G4 (NVIDIA RTX PRO 6000 Blackwell, 96 GB, 48 CPUs) in hagopjay's Colab Pro.

## Profiles (build_crawl_v2.py `--profile=`)

| Profile | Where | Texels/m | Samples (light pass) | Light resolution | Gloss pass | Expected time |
|---|---|---|---|---|---|---|
| quick | Mac or G4 smoke | 1/4 of local | 1/4 of local | 1/4 of albedo | King's + Hall floor | Mac 8 min (measured) |
| local | Mac | hall 56, kings 110, gallery 60, osiris 64, plateau 3 | 96 to 160 | 1/4 | King's + Hall floor | Mac, measured in bake.json |
| g4 | G4 | 1.5 x local | 4 x local (384 to 640) | 1/2 | every surface | not yet measured |

Textures stay at most 4096 px on a side (WebGL limit on many phones and laptops).

## Steps (you run them; about 10 minutes of your attention)

1. `python3 -I docs/demos/blender-giza-crawl/v2/build/g4/build_g4_notebook.py` re-embeds the current sources from the four
   demo folders and prints the build id. A built copy is committed beside it: `giza_bakes_g4.ipynb`.
2. Colab, signed in as hagopjay: File ▸ Upload notebook ▸ that file. Runtime ▸ Change runtime type ▸ G4 GPU.
3. Run cells 1 to 4. Cell 1 must name the RTX PRO 6000; cell 3 prints the Blender version and the add-on commit.
4. Cell 5: `JOB = "crawl"`, `PROFILE = "quick"`, `DEVICE = "OPTIX"`. Run cells 6 and 7. This proves OptiX baking and
   the export (a few minutes). Cell 6 prints `BAKE DEVICE OPTIX [...]` first: if it says CPU, stop.
5. Cell 5: `PROFILE = "g4"`, run 6 and 7 again; then the same for `JOB = "masonic"`, `"fall"`, `"twins"`.
6. Tell Claude "G4 bake crawl-g4 done". Claude reads `My Drive/x3d.io/blenderizer-bakes/crawl-g4/` (shared with
   hagsmac37), then on the Mac: `assemble.py` (grade from the linear caches, post-process, copy), `shots.cjs`
   (before/after, console, frame time), `validate_one.py` (XSD + semantics), README numbers, and shows you the frames.
7. Runtime ▸ Disconnect and delete runtime.

## Jobs

| Job | Demo folder | Mac preview (profile) | Mac bake time | G4 |
|---|---|---|---|---|
| crawl | blender-giza-crawl/v2 | quick | 280 s | `g4`: about 50 surfaces |
| masonic | masonic-lodge/v3 | local | 542 s | `g4` |
| fall | blender-giza-fall/v2 | quick | sim + bake, about 4 min | `g4` |
| twins | semantic-twins/v3 and fault-lab/v3 (same context layer) | quick | 18 s | `g4` |

Order on the G4: `crawl` quick (smoke), then `crawl`, `masonic`, `fall`, `twins` at `g4`. Each is cells 5 to 7.

A job is added by putting its build folder and entry script in `JOBS` in `build_g4_notebook.py`; every job takes
`OUT_DIR ADDON_SOURCE_DIR --profile=...` and honours `BAKE_DEVICE`.

## What can go wrong

- `BAKE DEVICE CPU (no OPTIX device)`: wrong runtime type, or the driver is not visible; try `DEVICE = "CUDA"`.
- Cycles builds its light tree again for every bake: with 200+ lamps that is seconds per bake. Expected, not a hang.
- The JEPA notebook found Cycles re-creating its GPU session per frame; a bake is one session per surface, so the
  per-surface overhead (scene sync, kernel load) is what to watch in `build.log` timings.
- Drive copies of `cache/*.npy` are large (about 0.7 GB for `local`, more for `g4`). They let the Mac re-grade without a
  re-bake; delete them from Drive after the demo merges.
