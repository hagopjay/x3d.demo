# Inventory: tile and imagery data found for the Burruss zoom-out (18 Nov 2026)

Counted on the project mount and in `hagopjay/x3d.poc` (read-only clone). Sizes are as listed by the filesystem.

## Used in v1 (planet-scale build, `/mnt/project-files/polyxandria/planet-scale/data/`)
| Dir | What | Files | Bytes | Source and licence |
|---|---|---|---|---|
| `sat7 sat11 sat13 sat15` | 2D satellite, 256 px JPEG | 20 + 16 + 16 + 16 = 68 | 1.95 MB | Google Map Tiles API (paid, 3 sessions, about $0.04 in its own log); academic non-commercial PoC only |
| `terr3 terr7 terr11 terr13 terr15` | terrarium elevation PNG | 64 + 20 + 16 + 16 + 16 = 132 | 11.7 MB | AWS Terrain Tiles, open |
| `derived/*.json` | meshes for the original zoom (campus, town, valley, region, globe) | 7 | 8.9 MB | derived from the two rows above |
| `drillfield*` | Solar API 0.25 m DSM + RGB of the Drillfield (400 x 300 m) | 2 requests | see `drillfield-receipt.json` | Google Solar API; same terms |
| `earth-blue-marble.jpg`, `earth-night.jpg`, other textures, `hygdata_v41.csv` | globe and star data | - | - | NASA public domain; HYG database (CC BY-SA, check before redistribution) |

Total for the Google imagery that exists as tiles: 68 files, about 2 MB. `build.py` writes `data/inventory.json` with counts, bytes and a digest per directory.

## Not found
- Google **Photorealistic 3D Tiles bodies**: none stored anywhere on the mount. They were streamed live. Only `gcp-showcase/key-trace/verify-2026-10-11-1615/3dtiles-root.json` (64,625 bytes; 125 nodes, box volumes, 120 contents of which 32 GLB and 88 external JSON; session token expired) and `drillfield-satellite-z17.jpg` (37,794 bytes) were kept.
- The remainder of the "$50 of Google API fees" is not visible in any log opened here. Candidates still to read: `landing-v2/log`, `gulf-heritage-twin`, billing for project key-tokenizer-237718. Grade S until someone opens the billing console.

## Other usable assets (sweep, not yet used)
| Where | What | Size | Notes |
|---|---|---|---|
| `earth-twin/scenes/v4/` | Blacksburg campus twin: 919 buildings (lidar roofs), 8,078 trees, Sentinel-2 ground, GeoLOD campus | 46 MB (`campus-local.x3d` 21 MB, 4 campus quadrants 22 MB) | open data (USGS 3DEP lidar, Copernicus Sentinel-2): the clean candidate for a v2 campus level |
| `earth-twin/blender/v4/render-arrival-cycles.png`, `exhibit/v4/poster.jpg` | Cycles render and poster of the twin | 0.85 MB, 0.25 MB | high visual quality stills |
| `polyxandria/planet-scale/gpu/out/` | Drillfield Gaussian splats: `out_splats.ply` 30.8 MB, `stage-dsm-splats.x3d` 60.7 MB (453,485 splats, held-out 37.43 dB), `lite.ply` 4.1 MB; `fly/` 4K Cycles fly-through (12.9 MB mp4) | 197 MB | trained on Google Solar data, same terms |
| `polyxandria/landing-v2/gifts/` | `drillfield` 4.2 MB, `synthsplat` 66 MB, `hero` 2.9 MB, `materials` 11 MB | 99 MB | |
| `polyxandria/giza/` | Giza twin, shots, Sphinx research | 467 MB | other geo site for a two-site continuum |
| `polyxandria/gulf-heritage-twin/`, `doha-site/`, `gulf-showstopper/` | Doha heritage twin and site | 32 + 76 + 7 MB | |
| `x3d.poc` `assets/gifts` 63 MB, `assets/data` 49 MB | gifts (drillfield, giza, pantheon, shroud posters) and Khufu / Pantheon splat data | 112 MB | |
| GCS `gs://polyx-planet-10112050` | temp bucket from the GPU run; 3 composite objects left | not listed | not touched: GCP is off, listing needs the owner's yes |

## Ranked next uses
1. **Campus level from open data**: swap the z15/Drillfield stage for `earth-twin` v4 (no licence risk, 919 buildings) under the same GeoLOD root.
2. **Drillfield splats as the finale** at 2.5 km range (Inline of `lite.ply` form): same Google-terms caveat.
3. **Giza and Doha as second and third sites** on the same globe with `--open-textures`.
4. Real photoreal tiles only by streaming live in the visitor's browser with attribution (A2 in earth-twin ASKS), which needs his yes and a key.
