# Geotiling v1: Burruss Hall to Earth in X3D (candidate Demo 47)

A multi-scale tile pyramid built from the data of the earlier "Drillfield to the Stars" zoom (x3d.poc, 11 Oct 2026), expressed three ways: native X3D `GeoLOD`, a 3D Tiles 1.1 tileset with GLB content, and a converter from 3D Tiles back to X3D `GeoLOD`.

Open `index.html` (served from the site; X_ITE is loaded from `../../blender-x3d-io/v1/vendor/x_ite/`).

| File | What |
|---|---|
| `root.x3d` | Globe (361 x 181 `GeoElevationGrid`, Blue Marble), 20 z7 tiles each a `GeoLOD` quadtree, `GeoLocation` beacons and Burruss pin, six `GeoViewpoint`s, a 90 s zoom-out tour by `GeoPositionInterpolator` + `OrientationInterpolator` (no Script), and the Drillfield 0.25 m DSM behind a `GeoLOD` of range 2.5 km (`drillfield-geo.x3d`, lifted 8 m to clear the terrain) |
| `tiles/zZ_X_Y.x3d`, `.mesh.x3d` | 132 tiles, z7 to z15: a `GeoLOD` wrapper (rootUrl = its own mesh, child1..4Url = quadrants) plus a `GeoElevationGrid` mesh with 33 x 33 posts and Mercator-correct `texCoord` |
| `tex/` | 256 px tile textures (Google satellite, see NOTICE.md) and the globe texture |
| `tileset.json`, `gltf/` | the same pyramid as 3D Tiles 1.1: region volumes, REPLACE, parent-relative ENU transforms, `KHR_materials_unlit` GLB |
| `tiles3d_to_x3d.py`, `converted/` | converter and its output (149 `GeoLOD` nodes in 177 files); renders the same pyramid |
| `build.py` | regenerates everything: `python3 -I build.py --data <planet-scale/data> --gate <x3d_mcp/src>`; `--open-textures` drops all Google imagery |
| `data/inventory.json`, `build-stats.json`, `measured.json`, `validation-tiles.json` | counts, sizes, findings and receipts the page reads |
| `INVENTORY.md`, `NOTICE.md` | what was found, what is missing, licence terms |

## How a tile becomes a `GeoLOD` range
`range = geometricError x 81.48`, from the 3D Tiles screen-space-error rule (1080 px, 45 degree field of view, 16 px). `geometricError = tile ground width / 51`, so a tile refines at about 1.6 tile widths.

## Validated and measured
- 266 X3D files (`tiles/`, `root.x3d`, `drillfield-geo.x3d`) plus 177 in `converted/`: 0 invalid on `hagopjay/x3d_mcp` fa5dccf `validate_xml`.
- X_ITE 16.6.0, headless Chromium, SwiftShader (no GPU), 1000 x 640: GeoLOD streams z7 to z14 around Blacksburg in about 25 s at 4.5 km (4 to 5 fps); with the Drillfield DSM in view the frame rate drops to 0.5 fps and streaming slows to about 100 s per level. Not run: a real GPU, other browsers, phones, the converter on real Google GLB bodies.

## Known gaps
No skirts, so hairline cracks appear where neighbouring tiles differ in level. Refine ADD is treated as REPLACE. Tiles with no finer source are upsampled leaves. The heights are 10 m class terrarium data, not lidar. Google Photorealistic 3D Tiles are not included.
